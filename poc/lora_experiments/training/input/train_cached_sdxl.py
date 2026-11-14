"""SDXL UNet LoRA: Diffusers/PEFT recipe with cached conditioning and native aspect ratios.

The frozen SDXL base is never saved as a trained adapter. Only learned LoRA weights
are exported. Sources: Diffusers v0.42.0 official SDXL LoRA trainer and model API.
"""
import csv
import gc
import hashlib
import json
import math
import os
import random
import re
import time
import traceback
import zipfile
from pathlib import Path
import importlib.util
import subprocess
import sys

# Kaggle includes torchao 0.10 while PEFT 0.21 requires >=0.16 when detected.
# Vanilla LoRA does not need torchao; remove only this optional runtime package.
if Path('/kaggle/working').is_dir() and importlib.util.find_spec('torchao') is not None:
    subprocess.run([sys.executable,'-m','pip','uninstall','-y','torchao'],check=True)

import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from diffusers import DDPMScheduler, StableDiffusionXLPipeline
from diffusers.training_utils import cast_training_params
from diffusers.utils import convert_state_dict_to_diffusers
from peft import LoraConfig
from peft.utils import get_peft_model_state_dict

OUT=Path('/kaggle/working')
MODEL='stabilityai/stable-diffusion-xl-base-1.0'
REVISION='462165984030d82259a11f4367a4eed129e94a7b'
CONFIG={'rank':8,'learning_rate':1e-4,'steps':300,'gradient_accumulation':2,
        'seed':20261112,'max_pixels':768*768,'max_side':1024,
        'text_encoder_training':False,'trigger':'luxbedstyle',
        'base_model':MODEL,'base_revision':REVISION,'mixed_precision':'fp16'}
REPORT={'status':'running','stage':'validate_data','step':0,'config':CONFIG,'losses':[],
        'optimizer_updates':0,'skipped_amp_steps':0,'timestamp_crops':[]}

def save_report():
    (OUT/'training_report.json').write_text(json.dumps(REPORT,indent=2),encoding='utf8')

def resolve_data():
    manifest=next(Path('/kaggle/input').rglob('manifest.csv'))
    root=manifest.parent
    archives=list(root.rglob('images.zip'))
    if archives:
        root=OUT/'data';root.mkdir(exist_ok=True)
        with zipfile.ZipFile(archives[0]) as archive:archive.extractall(root)
    rows=list(csv.DictReader(manifest.open(encoding='utf-8-sig')))
    caption_path=next(Path('/kaggle/input').rglob('captions_final.jsonl'))
    captions={r['id']:r for r in map(json.loads,caption_path.read_text(encoding='utf8').splitlines())}
    train=[r for r in rows if r['split']=='train' and r['id'] in captions and captions[r['id']].get('qa_status')=='APPROVED']
    if len(train)<100:raise RuntimeError(f'Requires >=100 approved training photos; got {len(train)}')
    REPORT['train_count']=len(train)
    REPORT['manifest_sha256']=hashlib.sha256(manifest.read_bytes()).hexdigest()
    REPORT['captions_sha256']=hashlib.sha256(caption_path.read_bytes()).hexdigest()
    return root,train,captions

def fit_dimensions(width,height):
    factor=min(CONFIG['max_side']/max(width,height),math.sqrt(CONFIG['max_pixels']/(width*height)),1.0)
    return max(64,int(width*factor)//8*8),max(64,int(height*factor)//8*8)

def cache_conditioning(pipe,root,rows,captions):
    cached=[]
    pipe.vae.to(dtype=torch.float32)
    pipe.vae.enable_tiling()
    for i,row in enumerate(rows):
        path=root/row['file_name']
        if not path.exists():path=next(root.rglob(Path(row['file_name']).name))
        with Image.open(path) as source:image=ImageOps.exif_transpose(source).convert('RGB')
        ow,oh=image.size
        if re.search(r'\b(R12S|Px3)\b',row['title']):
            bottom=int(oh*.96)
            image=image.crop((0,0,ow,bottom))
            REPORT['timestamp_crops'].append({'id':row['id'],'bottom_pixels_removed':oh-bottom})
        tw,th=fit_dimensions(*image.size)
        image=image.resize((tw,th),Image.Resampling.LANCZOS)
        import numpy as np
        pixels=torch.from_numpy(np.asarray(image).copy()).permute(2,0,1).unsqueeze(0).to('cuda:0',dtype=torch.float32)/127.5-1
        caption=CONFIG['trigger']+', luxury bedroom, '+captions[row['id']]['caption']
        with torch.inference_mode():
            embeds,_,pooled,_=pipe.encode_prompt(prompt=caption,device='cuda:0',do_classifier_free_guidance=False)
            latent=pipe.vae.encode(pixels).latent_dist.sample()*pipe.vae.config.scaling_factor
        if not torch.isfinite(latent).all():raise RuntimeError('Nonfinite cached latent '+row['id'])
        cached.append({'id':row['id'],'latent':latent.detach().cpu().to(torch.float16),
            'prompt':embeds.detach().cpu(),'pooled':pooled.detach().cpu(),
            'time_ids':torch.tensor([[oh,ow,0,0,th,tw]],dtype=torch.float16)})
        if (i+1)%10==0:
            REPORT['cached_count']=i+1;save_report();print('cached',i+1,'/',len(rows),flush=True)
    return cached

def export_adapter(unet,directory):
    directory.mkdir(exist_ok=True,parents=True)
    state=convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
    StableDiffusionXLPipeline.save_lora_weights(str(directory),unet_lora_layers=state)
    (directory/'training_config.json').write_text(json.dumps(CONFIG,indent=2))

def train():
    torch.manual_seed(CONFIG['seed']);random.seed(CONFIG['seed'])
    root,rows,captions=resolve_data();save_report()
    REPORT['stage']='load_base';save_report()
    pipe=StableDiffusionXLPipeline.from_pretrained(MODEL,revision=REVISION,
        variant='fp16',torch_dtype=torch.float16,use_safetensors=True).to('cuda:0')
    pipe.set_progress_bar_config(disable=True)
    REPORT['stage']='cache_conditioning';save_report()
    cached_files=list(Path('/kaggle/input').rglob('conditioning_cache.pt'))
    if cached_files:
        saved=torch.load(cached_files[0],map_location='cpu',weights_only=True)
        if saved['captions_sha256']==REPORT['captions_sha256'] and saved['manifest_sha256']==REPORT['manifest_sha256']:
            cache=saved['cache'];REPORT['reused_conditioning_cache']=True
        else:cache=cache_conditioning(pipe,root,rows,captions)
    else:cache=cache_conditioning(pipe,root,rows,captions)
    torch.save({'cache':cache,'captions_sha256':REPORT['captions_sha256'],
                'manifest_sha256':REPORT['manifest_sha256']},OUT/'conditioning_cache.pt')
    unet=pipe.unet
    pipe.text_encoder.to('cpu');pipe.text_encoder_2.to('cpu');pipe.vae.to('cpu')
    del pipe;gc.collect();torch.cuda.empty_cache()
    unet.requires_grad_(False)
    unet.add_adapter(LoraConfig(r=CONFIG['rank'],lora_alpha=CONFIG['rank'],
        init_lora_weights='gaussian',target_modules=['to_k','to_q','to_v','to_out.0']))
    cast_training_params(unet,dtype=torch.float32)
    unet.enable_gradient_checkpointing();unet.train()
    parameters=[p for p in unet.parameters() if p.requires_grad]
    REPORT['trainable_parameters']=sum(p.numel() for p in parameters)
    optimizer=torch.optim.AdamW(parameters,lr=CONFIG['learning_rate'],weight_decay=.01)
    scheduler=DDPMScheduler.from_pretrained(MODEL,subfolder='scheduler',revision=REVISION)
    scaler=torch.amp.GradScaler('cuda')
    order=list(range(len(cache)));position=0
    REPORT['stage']='training';save_report();start=time.perf_counter()
    for step in range(1,CONFIG['steps']+1):
        optimizer.zero_grad(set_to_none=True);total_loss=0.0
        warmup=min(1.0,step/20)
        for group in optimizer.param_groups:group['lr']=CONFIG['learning_rate']*warmup
        for _ in range(CONFIG['gradient_accumulation']):
            if position==0:random.shuffle(order)
            item=cache[order[position]];position=(position+1)%len(order)
            latent=item['latent'].to('cuda:0');noise=torch.randn_like(latent)
            timestep=torch.randint(0,scheduler.config.num_train_timesteps,(1,),device='cuda:0').long()
            noisy=scheduler.add_noise(latent,noise,timestep)
            target=noise if scheduler.config.prediction_type=='epsilon' else scheduler.get_velocity(latent,noise,timestep)
            with torch.autocast('cuda',dtype=torch.float16):
                pred=unet(noisy,timestep,encoder_hidden_states=item['prompt'].to('cuda:0'),
                    added_cond_kwargs={'text_embeds':item['pooled'].to('cuda:0'),'time_ids':item['time_ids'].to('cuda:0')}).sample
                loss=F.mse_loss(pred.float(),target.float(),reduction='mean')/CONFIG['gradient_accumulation']
            if not torch.isfinite(loss):raise RuntimeError(f'Nonfinite loss at step {step}')
            scaler.scale(loss).backward();total_loss+=float(loss.detach())
        scaler.unscale_(optimizer);torch.nn.utils.clip_grad_norm_(parameters,1.0)
        previous_scale=scaler.get_scale()
        scaler.step(optimizer);scaler.update()
        if scaler.get_scale()<previous_scale:REPORT['skipped_amp_steps']+=1
        else:REPORT['optimizer_updates']+=1
        REPORT['step']=step;REPORT['losses'].append({'step':step,'loss':total_loss})
        if step%10==0 or step==1:
            REPORT['elapsed_training_seconds']=time.perf_counter()-start
            REPORT['peak_gpu_gib']=torch.cuda.max_memory_allocated()/1024**3
            save_report();print('step',step,'loss',round(total_loss,5),flush=True)
        if step%100==0:
            folder=OUT/f'checkpoint-{step}';export_adapter(unet,folder)
            torch.save({'step':step,'optimizer':optimizer.state_dict(),'scaler':scaler.state_dict()},folder/'optimizer.pt')
    export_adapter(unet,OUT/'luxury_lora')
    REPORT['status']='complete';REPORT['stage']='saved';save_report()

if __name__=='__main__':
    try:train()
    except Exception as e:
        REPORT['status']='failed';REPORT['error']=str(e);REPORT['traceback']=traceback.format_exc();save_report()
    print(json.dumps({k:v for k,v in REPORT.items() if k!='losses'},indent=2),flush=True)

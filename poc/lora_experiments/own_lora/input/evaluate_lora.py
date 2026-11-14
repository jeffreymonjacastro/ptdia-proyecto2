import csv
import itertools
import json
import subprocess
import sys
import time
import traceback
from pathlib import Path
import importlib.util

if Path('/kaggle/working').is_dir() and importlib.util.find_spec('torchao') is not None:
    subprocess.run([sys.executable,'-m','pip','uninstall','-y','torchao'],check=True)
if importlib.util.find_spec('skimage') is None:
    subprocess.run([sys.executable,'-m','pip','install','scikit-image==0.26.0'],check=True)

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps
from diffusers import StableDiffusionXLImg2ImgPipeline
from skimage.metrics import structural_similarity

OUT=Path('/kaggle/working');IMAGES=OUT/'generations';IMAGES.mkdir(exist_ok=True)
REPORT={'status':'running','results':[],'adapter':'trained_luxury',
    'scales':[.5,.8,1.0],'strengths':[.35,.55,.75],'seeds':[42,123]}
def save(): (OUT/'lora_evaluation_report.json').write_text(json.dumps(REPORT,indent=2))
def metrics(original,result):
    a=np.asarray(original.resize((256,256))).astype(np.float32)/255
    b=np.asarray(result.resize((256,256))).astype(np.float32)/255
    return {'rgb_mae_0_1':float(np.abs(a-b).mean()),
            'ssim_to_input':float(structural_similarity(a,b,data_range=1,channel_axis=2))}

try:
    base_report_path=next(Path('/kaggle/input').rglob('baseline_report.json'))
    base=json.loads(base_report_path.read_text())
    if base['status']!='complete':raise RuntimeError('A complete baseline is required')
    REPORT['baseline_config']={k:v for k,v in base.items() if k!='results'}
    local_weights=OUT/'luxury_lora'/'pytorch_lora_weights.safetensors'
    weights=local_weights if local_weights.exists() else next(p for p in Path('/kaggle/input').rglob('pytorch_lora_weights.safetensors') if p.parent.name=='luxury_lora')
    originals=sorted(base_report_path.parent.rglob('*_original.png'))
    if len(originals)!=3:raise RuntimeError(f'Expected 3 baseline input images, got {len(originals)}')
    pipe=StableDiffusionXLImg2ImgPipeline.from_pretrained(base['base_model'],revision=base['base_revision'],
        torch_dtype=torch.float16,variant='fp16',use_safetensors=True).to('cuda:0')
    pipe.vae.enable_tiling();pipe.set_progress_bar_config(disable=True)
    pipe.load_lora_weights(str(weights.parent),weight_name=weights.name,adapter_name='trained_luxury')
    for source in originals:
        image=Image.open(source).convert('RGB');sample_id=source.stem.replace('_original','')
        image.save(IMAGES/source.name)
        for strength,scale,seed in itertools.product(REPORT['strengths'],REPORT['scales'],REPORT['seeds']):
            pipe.set_adapters('trained_luxury',adapter_weights=scale)
            start=time.perf_counter();torch.cuda.reset_peak_memory_stats()
            with torch.inference_mode():
                result=pipe(prompt=base['prompt'],negative_prompt=base['negative_prompt'],image=image,
                    strength=strength,num_inference_steps=base['steps'],guidance_scale=base['guidance_scale'],
                    generator=torch.Generator(device='cuda:0').manual_seed(seed)).images[0]
            name=f'{sample_id}_trained_s{strength}_l{scale}_seed{seed}.png';result.save(IMAGES/name)
            row={'id':sample_id,'strength':strength,'lora_scale':scale,'seed':seed,'file':name,
                 'seconds':time.perf_counter()-start,'peak_gpu_gib':torch.cuda.max_memory_allocated()/1024**3,
                 **metrics(image,result)}
            REPORT['results'].append(row);save()
            print('generated',len(REPORT['results']),'/ 54',flush=True)
        sheet=Image.new('RGB',(4*330,3*250),'white');draw=ImageDraw.Draw(sheet)
        for rowindex,strength in enumerate(REPORT['strengths']):
            im=ImageOps.contain(image,(320,210));sheet.paste(im,(0,rowindex*250+30))
            draw.text((6,rowindex*250+8),f'INPUT | strength {strength}',fill='black')
            for col,scale in enumerate(REPORT['scales'],1):
                path=IMAGES/f'{sample_id}_trained_s{strength}_l{scale}_seed42.png'
                im=ImageOps.contain(Image.open(path),(320,210));sheet.paste(im,(col*330,rowindex*250+30))
                draw.text((col*330+6,rowindex*250+8),f'LoRA {scale} | seed 42',fill='black')
        sheet.save(OUT/(sample_id+'_parameter_grid.jpg'),quality=94)
    with (OUT/'generation_metrics.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(REPORT['results'][0]));w.writeheader();w.writerows(REPORT['results'])
    REPORT['status']='complete'
    REPORT['metric_note']='RGB MAE and SSIM at 256x256 measure change, not decoration quality or guaranteed geometry preservation.'
except Exception as e:
    REPORT['status']='failed';REPORT['error']=str(e);REPORT['traceback']=traceback.format_exc()
finally:save();print(json.dumps({k:v for k,v in REPORT.items() if k!='results'},indent=2))

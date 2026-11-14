import importlib.util
import subprocess
import sys
from pathlib import Path
if Path('/kaggle/working').is_dir() and importlib.util.find_spec('torchao') is not None:
    subprocess.run([sys.executable,'-m','pip','uninstall','-y','torchao'],check=True)
import hashlib
import itertools
import json
import time
import traceback
import torch
from PIL import Image,ImageDraw,ImageOps
from diffusers import StableDiffusionXLImg2ImgPipeline

OUT=Path('/kaggle/working');IMAGES=OUT/'generations';IMAGES.mkdir(exist_ok=True)
REPORT={'status':'running','results':[],'seed':42,'strengths':[.45,.65],'scales':[.6,.9]}
def save(): (OUT/'pretrained_comparison_report.json').write_text(json.dumps(REPORT,indent=2))
try:
    catalog=json.loads(next(Path('/kaggle/input').rglob('pretrained_catalog.json')).read_text())
    source=next(Path('/kaggle/input').rglob('C133553208_original.png'))
    image=Image.open(source).convert('RGB');image.save(OUT/'original.png')
    pipe=StableDiffusionXLImg2ImgPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0',
        revision='462165984030d82259a11f4367a4eed129e94a7b',torch_dtype=torch.float16,variant='fp16',use_safetensors=True).to('cuda:0')
    pipe.vae.enable_tiling();pipe.set_progress_bar_config(disable=True)
    for model in catalog:
        path=next(Path('/kaggle/input').rglob(model['file_name']))
        digest=hashlib.file_digest(path.open('rb'),'sha256').hexdigest().upper()
        if digest!=model['sha256_expected'].upper():raise RuntimeError('Hash mismatch for '+model['style'])
        pipe.unload_lora_weights()
        pipe.load_lora_weights(str(path.parent),weight_name=path.name,adapter_name='selected_style',local_files_only=True)
        prompt=model['trigger']+', photograph of a bedroom, coordinated furniture and lighting, realistic interior photography, preserve the bed position, windows and room layout.'
        results=[]
        for strength,scale in itertools.product(REPORT['strengths'],REPORT['scales']):
            pipe.set_adapters('selected_style',adapter_weights=scale);start=time.perf_counter();torch.cuda.reset_peak_memory_stats()
            with torch.inference_mode():
                generated=pipe(prompt=prompt,negative_prompt='cartoon, illustration, warped walls, distorted furniture, blurry',
                    image=image,strength=strength,num_inference_steps=25,guidance_scale=7.5,
                    generator=torch.Generator(device='cuda:0').manual_seed(42)).images[0]
            name=f"{model['style']}_s{strength}_l{scale}.png";generated.save(IMAGES/name)
            REPORT['results'].append({'style':model['style'],'strength':strength,'lora_scale':scale,'seed':42,
                'steps':25,'guidance_scale':7.5,'prompt':prompt,'sha256':digest,'version_id':model['version_id'],
                'file':name,'seconds':time.perf_counter()-start,'peak_gpu_gib':torch.cuda.max_memory_allocated()/1024**3})
            save();results.append((strength,scale,generated.copy()));print('generated',len(REPORT['results']),'/ 20',flush=True)
        sheet=Image.new('RGB',(4*360,290),'white');draw=ImageDraw.Draw(sheet)
        for i,(strength,scale,generated) in enumerate(results):
            im=ImageOps.contain(generated,(350,250));sheet.paste(im,(i*360,35))
            draw.text((i*360+5,10),f"{model['style']} s={strength} LoRA={scale}",fill='black')
        sheet.save(OUT/(model['style']+'_comparison.jpg'),quality=94)
    REPORT['status']='complete'
    REPORT['note']='One bedroom, four controlled configurations per pretrained style. No third-party weights were trained, merged or exported.'
except Exception as e:
    REPORT['status']='failed';REPORT['error']=str(e);REPORT['traceback']=traceback.format_exc()
finally:save();print(json.dumps({k:v for k,v in REPORT.items() if k!='results'},indent=2))

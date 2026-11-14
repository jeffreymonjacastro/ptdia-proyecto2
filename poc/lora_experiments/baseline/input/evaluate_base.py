import csv
import itertools
import json
import math
import time
import traceback
import zipfile
from pathlib import Path

import torch
from PIL import Image,ImageDraw,ImageOps
from diffusers import StableDiffusionXLImg2ImgPipeline

OUT=Path('/kaggle/working');IMAGES=OUT/'generations';IMAGES.mkdir(exist_ok=True)
REPORT={'status':'running','adapter':None,'results':[],
    'base_model':'stabilityai/stable-diffusion-xl-base-1.0',
    'base_revision':'462165984030d82259a11f4367a4eed129e94a7b'}
PROMPT='luxbedstyle, photograph of a luxury bedroom, elegant coordinated furniture, refined headboard, layered lighting, premium-looking textiles, realistic interior photography, preserve the room layout, bed position and windows.'
NEGATIVE='illustration, cartoon, distorted furniture, warped walls, blurry, duplicate beds'
def save(): (OUT/'baseline_report.json').write_text(json.dumps(REPORT,indent=2))
try:
    mf=next(Path('/kaggle/input').rglob('evaluation_inputs.csv'));root=mf.parent
    archives=list(root.rglob('images.zip'))
    if archives:
        root=OUT/'data';root.mkdir(exist_ok=True)
        with zipfile.ZipFile(archives[0]) as z:z.extractall(root)
    rows=list(csv.DictReader(mf.open(encoding='utf-8-sig')))
    pipe=StableDiffusionXLImg2ImgPipeline.from_pretrained(REPORT['base_model'],revision=REPORT['base_revision'],
        torch_dtype=torch.float16,variant='fp16',use_safetensors=True).to('cuda:0')
    pipe.vae.enable_tiling();pipe.set_progress_bar_config(disable=True)
    REPORT.update(prompt=PROMPT,negative_prompt=NEGATIVE,steps=25,guidance_scale=7.5,scheduler=type(pipe.scheduler).__name__)
    for row in rows:
        path=root/row['file_name']
        if not path.exists():path=next(root.rglob(Path(row['file_name']).name))
        with Image.open(path) as original:image=ImageOps.exif_transpose(original).convert('RGB')
        factor=min(1024/max(image.size),math.sqrt(768*768/(image.width*image.height)))
        size=(int(image.width*factor)//8*8,int(image.height*factor)//8*8)
        image=image.resize(size,Image.Resampling.LANCZOS);image.save(IMAGES/(row['id']+'_original.png'))
        generated=[]
        for strength,seed in itertools.product([.35,.55,.75],[42,123]):
            start=time.perf_counter();torch.cuda.reset_peak_memory_stats()
            with torch.inference_mode():
                result=pipe(prompt=PROMPT,negative_prompt=NEGATIVE,image=image,strength=strength,
                    num_inference_steps=25,guidance_scale=7.5,generator=torch.Generator(device='cuda:0').manual_seed(seed)).images[0]
            name=f"{row['id']}_base_s{strength}_seed{seed}.png";result.save(IMAGES/name)
            REPORT['results'].append({'id':row['id'],'strength':strength,'seed':seed,'width':size[0],
                'height':size[1],'seconds':time.perf_counter()-start,'peak_gpu_gib':torch.cuda.max_memory_allocated()/1024**3,'file':name})
            save();generated.append((strength,seed,result.copy()));print('generated',len(REPORT['results']),'/ 18',flush=True)
        sheet=Image.new('RGB',(3*384,3*265),'white');draw=ImageDraw.Draw(sheet)
        im=ImageOps.contain(image,(374,230));sheet.paste(im,(0,25));draw.text((6,6),'ORIGINAL | '+row['id'],fill='black')
        for i,(strength,seed,result) in enumerate(generated):
            x=i%3*384;y=(i//3+1)*265
            im=ImageOps.contain(result,(374,230));sheet.paste(im,(x,y+25));draw.text((x+6,y+6),f'strength={strength} seed={seed}',fill='black')
        sheet.save(OUT/(row['id']+'_baseline_grid.jpg'),quality=92)
    REPORT['status']='complete'
except Exception as e:
    REPORT['status']='failed';REPORT['error']=str(e);REPORT['traceback']=traceback.format_exc()
finally:save();print(json.dumps({k:v for k,v in REPORT.items() if k!='results'},indent=2))

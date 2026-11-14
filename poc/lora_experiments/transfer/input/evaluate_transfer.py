import csv,hashlib,importlib.util,json,math,subprocess,sys,time,traceback,zipfile
from pathlib import Path

if Path('/kaggle/working').is_dir() and importlib.util.find_spec('torchao') is not None:
    subprocess.run([sys.executable,'-m','pip','uninstall','-y','torchao'],check=True)
import torch
from PIL import Image,ImageOps,ImageDraw
from diffusers import StableDiffusionXLImg2ImgPipeline

OUT=Path('/kaggle/working');IMAGES=OUT/'images';IMAGES.mkdir(exist_ok=True)
report={'status':'running','split':'transfer_evaluation','purpose':'Fixed-parameter ordinary-looking bedroom to Luxury evaluation; six rooms, two seeds','strength':.75,'lora_scale':.8,'seed':42,'steps':25,'guidance_scale':7.5,'results':[]}
def save(): (OUT/'transfer_report.json').write_text(json.dumps(report,indent=2))
try:
    mf=next(Path('/kaggle/input').rglob('transfer_manifest.csv'))
    rows=list(csv.DictReader(mf.open(encoding='utf-8-sig')))
    assert len(rows)==6
    data=mf.parent
    archive=mf.parent/'transfer_images.zip'
    if archive.exists():
        data=OUT/'data';data.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as z:z.extractall(data)
    training=json.loads(next(Path('/kaggle/input').rglob('training_report.json')).read_text())
    protocol=json.loads((mf.parent/'protocol.json').read_text()); assert training['status']=='complete'; assert protocol['manifest_sha256']==hashlib.sha256(mf.read_bytes()).hexdigest()
    bp=next(Path('/kaggle/input').rglob('baseline_report.json'))
    config=json.loads(bp.read_text())
    report.update({k:config[k] for k in ['base_model','base_revision','prompt','negative_prompt','scheduler']})
    report['input_ids']=[r['id'] for r in rows]
    report['manifest_sha256']=protocol['manifest_sha256'];report['protocol']=protocol
    weights=next(p for p in Path('/kaggle/input').rglob('pytorch_lora_weights.safetensors') if p.parent.name=='luxury_lora')
    digest=hashlib.sha256(weights.read_bytes()).hexdigest()
    assert digest=='aad41fa2c1ab8a7b044a9e3acebb8651f562baa658f72262a99d242e4b5cc05b'
    report['weights_sha256']=digest
    pipe=StableDiffusionXLImg2ImgPipeline.from_pretrained(config['base_model'],revision=config['base_revision'],torch_dtype=torch.float16,variant='fp16',use_safetensors=True).to('cuda:0')
    pipe.vae.enable_tiling();pipe.set_progress_bar_config(disable=True)
    for model in ['base','own_lora']:
        if model=='own_lora':
            pipe.load_lora_weights(str(weights.parent),weight_name=weights.name,adapter_name='own')
            pipe.set_adapters('own',adapter_weights=.8)
        for row,seed in [(r,s) for r in rows for s in [42,123]]:
            path=data/row['file_name']
            if not path.exists():path=next(data.rglob(Path(row['file_name']).name))
            assert hashlib.sha256(path.read_bytes()).hexdigest()==row['sha256']
            with Image.open(path) as im:image=ImageOps.exif_transpose(im).convert('RGB')
            factor=min(1024/max(image.size),math.sqrt(768*768/(image.width*image.height)))
            size=(int(image.width*factor)//8*8,int(image.height*factor)//8*8)
            image=image.resize(size,Image.Resampling.LANCZOS)
            if model=='base' and seed==42:image.save(IMAGES/f'{row["id"]}_original.png')
            start=time.perf_counter();torch.cuda.reset_peak_memory_stats()
            with torch.inference_mode():
                result=pipe(prompt=config['prompt'],negative_prompt=config['negative_prompt'],image=image,strength=.75,num_inference_steps=25,guidance_scale=7.5,generator=torch.Generator(device='cuda:0').manual_seed(seed)).images[0]
            filename=f'{row["id"]}_{model}_seed{seed}.png';result.save(IMAGES/filename)
            report['results'].append({'id':row['id'],'model':model,'seed':seed,'file':filename,'seconds':time.perf_counter()-start,'width':size[0],'height':size[1],'peak_gpu_gib':torch.cuda.max_memory_allocated()/1024**3})
            save();print('generated',len(report['results']),'/ 24',flush=True)
    for index,row in enumerate(rows,1):
        sheet=Image.new('RGB',(1200,330),'white');draw=ImageDraw.Draw(sheet)
        for col,(suffix,label) in enumerate([('original','Entrada'),('base_seed42','SDXL base, seed42'),('own_lora_seed42','LoRA propio, seed42')]):
            im=ImageOps.contain(Image.open(IMAGES/f'{row["id"]}_{suffix}.png'),(390,285))
            sheet.paste(im,(col*400+(400-im.width)//2,35))
            draw.text((col*400+8,8),f'T{index:02d} | {row["id"]} | {label}',fill='black')
        sheet.save(OUT/f'T{index:02d}_comparison.jpg',quality=94)
    report['status']='complete'
except Exception as e:
    report.update(status='failed',error=str(e),traceback=traceback.format_exc())
finally:save();print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))

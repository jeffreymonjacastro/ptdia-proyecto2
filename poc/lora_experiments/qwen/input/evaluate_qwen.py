import csv
import itertools
import json
import time
import traceback
import zipfile
from pathlib import Path

import torch
from PIL import Image,ImageOps
from transformers import AutoProcessor,Qwen3_5ForConditionalGeneration

OUT=Path('/kaggle/working')
REPORT={'status':'running','model':'Qwen/Qwen3.5-4B','revision':'851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a','results':[]}
TRUTH={'C133553208':1,'C195397852':1,'C61546110':1,'C155392738':2}
PROMPT=('Return ONLY one JSON object with exactly these three keys: bed_count (integer count of visible beds), '
        'main_bedding_color (short English string), caption (one factual English sentence of at most 30 words). '
        'Describe only what is visible. Do not add any other keys or markdown.')
CONDITIONS=[{'name':f'greedy_{n}','do_sample':False,'max_new_tokens':n,'seed':42} for n in [80,160,320]]
CONDITIONS += [{'name':f'sample_t{t}','do_sample':True,'temperature':t,'top_p':.9,'max_new_tokens':160,'seed':seed}
               for t,seed in itertools.product([.3,.7],[42,123])]
def save(): (OUT/'qwen_evaluation_report.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))
try:
    mf=next(Path('/kaggle/input').rglob('evaluation_inputs.csv'));root=mf.parent
    archives=list(root.rglob('images.zip'))
    if archives:
        root=OUT/'data';root.mkdir(exist_ok=True)
        with zipfile.ZipFile(archives[0]) as z:z.extractall(root)
    rows=list(csv.DictReader(mf.open(encoding='utf-8-sig')))
    style_manifest=next(Path('/kaggle/input').rglob('manifest.csv'))
    style_rows=list(csv.DictReader(style_manifest.open(encoding='utf-8-sig')))
    rows.append(next(r for r in style_rows if r['id']=='C155392738'))
    prior={}
    for previous in Path('/kaggle/input').rglob('qwen_evaluation_report.json'):
        old=json.loads(previous.read_text())
        for result in old.get('results',[]):
            prior[(result['id'],result['name'],result['seed'])]=result
    processor=AutoProcessor.from_pretrained(REPORT['model'],revision=REPORT['revision'])
    model=Qwen3_5ForConditionalGeneration.from_pretrained(REPORT['model'],revision=REPORT['revision'],dtype=torch.float16,device_map={'':0},attn_implementation='sdpa').eval()
    REPORT['prompt']=PROMPT
    for row in rows:
        path=root/row['file_name']
        if not path.exists():path=next(root.rglob(Path(row['file_name']).name))
        with Image.open(path) as source:image=ImageOps.contain(source.convert('RGB'),(768,768))
        messages=[{'role':'user','content':[{'type':'image','image':image},{'type':'text','text':PROMPT}]}]
        inputs=processor.apply_chat_template(messages,tokenize=True,add_generation_prompt=True,return_dict=True,return_tensors='pt',enable_thinking=False).to('cuda:0')
        for condition in CONDITIONS:
            key=(row['id'],condition['name'],condition['seed'])
            if key in prior:
                result=dict(prior[key]);result['expected_bed_count']=TRUTH[row['id']]
                result['bed_count_correct']=result.get('parsed',{}).get('bed_count')==TRUTH[row['id']]
                result['reused']=True;REPORT['results'].append(result);save();continue
            torch.manual_seed(condition['seed']);torch.cuda.manual_seed_all(condition['seed'])
            kwargs={k:v for k,v in condition.items() if k not in ('name','seed')}
            start=time.perf_counter()
            with torch.inference_mode():tokens=model.generate(**inputs,**kwargs)
            text=processor.decode(tokens[0,inputs['input_ids'].shape[1]:],skip_special_tokens=True).strip()
            result={'id':row['id'],**condition,'seconds':time.perf_counter()-start,'text':text,
                    'generated_tokens':tokens.shape[1]-inputs['input_ids'].shape[1],
                    'expected_bed_count':TRUTH[row['id']],'valid_json':False,'exact_schema':False,'bed_count_correct':False}
            try:
                parsed=json.loads(text);result['parsed']=parsed;result['valid_json']=True
                result['exact_schema']=set(parsed)=={'bed_count','main_bedding_color','caption'}
                result['bed_count_correct']=parsed.get('bed_count')==TRUTH[row['id']]
            except (ValueError,TypeError):pass
            REPORT['results'].append(result);save();print('evaluated',len(REPORT['results']),'/ 28',flush=True)
    REPORT['status']='complete'
    REPORT['note']='Exploratory comparison on three ordinary-bedroom images and one two-bed reference. Visible sleeping surfaces are counted; the joined white sleeping area in C61546110 is one visible bed. Captioning and JSON reliability are distinct from full decision-summary evaluation.'
except Exception as e:
    REPORT['status']='failed';REPORT['error']=str(e);REPORT['traceback']=traceback.format_exc()
finally:save();print(json.dumps({k:v for k,v in REPORT.items() if k!='results'},indent=2))

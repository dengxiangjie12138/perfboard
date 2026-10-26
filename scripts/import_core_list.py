import argparse, collections, hashlib, json, pathlib, struct
import xlrd
from xlrd.compdoc import CompDoc

def import_core_list(source):
    raw = source.read_bytes()
    if raw[:8] != bytes.fromhex('d0cf11e0a1b11ae1'):
        raise ValueError('Expected an OLE XLS workbook; no conversion is performed')
    book = xlrd.open_workbook(file_contents=raw, formatting_info=True)
    if book.nsheets != 1:
        raise ValueError('Unexpected workbook structure; review sheets before importing')
    sheet = book.sheet_by_index(0)
    expected = ['TYPE','MATERIAL','Dimensions (mm)','Ap','Ae','Aw','AL','Le','Ve','Wt','PCL 100kHz 200mT','Pt  (100kHz)','可配合BOBBIN','','']
    if [str(v).strip() for v in sheet.row_values(1)] != expected:
        raise ValueError('Unexpected column headers; review before importing')
    labels = ['型号','材质','外形尺寸 A × B × C','Ap','Ae','Aw','AL','Le','Ve','重量','PCL 100kHz / 200mT / 100℃','Pt 100kHz','配套骨架幅宽','配套骨架 PIN','配套骨架形状']
    units = [None,None,'mm','cm4','mm2','mm2','nH/N2','mm','mm3','g','W','Watts',None,None,None]
    columns = [{'index':i,'label':labels[i],'unit':units[i],'rawHeader':sheet.cell_value(1,i),'rawSubheader':sheet.cell_value(2,i)} for i in range(15)]
    stream=CompDoc(raw).get_named_stream('Workbook'); offset=0; formulas=[]
    while offset+4 <= len(stream):
        code,size=struct.unpack_from('<HH',stream,offset)
        if code==6:
            row,col=struct.unpack_from('<HH',stream,offset+4); formulas.append({'row':row+1,'column':col+1})
        offset+=4+size
    records=[]; group=''; other=[]
    for index in range(3,sheet.nrows):
        values=sheet.row_values(index)
        if str(values[0]).startswith('TYPE') and not any(values[1:]):
            group=str(values[0]); other.append({'row':index+1,'values':values}); continue
        if not any(values):
            other.append({'row':index+1,'values':values}); continue
        if not values[0] or not values[1]:
            raise ValueError(f'Ambiguous record at row {index+1}')
        records.append({'id':f'Sheet1:{index+1}','sheet':sheet.name,'row':index+1,'group':group,'values':values})
    counts=collections.Counter(str(r['values'][0]) for r in records)
    return {'source':{'filename':source.name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'format':'OLE XLS','title':sheet.cell_value(0,0)},'sheet':{'name':sheet.name,'rows':sheet.nrows,'columns':sheet.ncols,'mergedCells':[list(region) for region in sheet.merged_cells],'headerRows':[sheet.row_values(i) for i in range(3)],'otherRows':other,'formulaCells':formulas},'columns':columns,'records':records,'audit':{'recordCount':len(records),'duplicateModels':[m for m,c in counts.items() if c>1],'missingByColumn':[sum(r['values'][i]=='' for r in records) for i in range(15)]}}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='Read original core reference XLS without changing it or any inventory database')
    parser.add_argument('source',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path)
    args=parser.parse_args(); data=import_core_list(args.source)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(data['audit'],ensure_ascii=False))


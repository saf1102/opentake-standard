ObjC.import('Foundation');
function run(args) {
  var fm=$.NSFileManager.defaultManager;
  function exists(p){return !!fm.fileExistsAtPath($(p));}
  function read(p){var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s)throw Error('无法读取：'+p);return ObjC.unwrap(s);}
  function write(p,v){if(!$(v).writeToFileAtomicallyEncodingError($(p),true,$.NSUTF8StringEncoding,null))throw Error('无法写入：'+p);}
  function copy(a,b){if(!fm.copyItemAtPathToPathError($(a),$(b),null))throw Error('复制失败：'+a);}
  var home=ObjC.unwrap($.NSHomeDirectory()),pkg=args[0],root=args[1];
  if(!root){
    var choices=[home+'/Movies/JianyingPro/User Data/Projects/com.lveditor.draft',home+'/Library/Application Support/JianyingPro/User Data/Projects/com.lveditor.draft'].filter(function(p){return exists(p+'/root_meta_info.json');});
    if(choices.length!==1)throw Error('无法唯一确定草稿目录。请先创建剪映空工程；自定义目录可拖入终端脚本提示处。');root=choices[0];
  }
  var rf=root+'/root_meta_info.json',before=read(rf),reg=JSON.parse(before),meta=JSON.parse(read(pkg+'/draft_meta_info.json')),content=JSON.parse(read(pkg+'/draft_info.json'));
  if(!Array.isArray(reg.all_draft_store)||!content.id||!content.materials)throw Error('无法识别此工程或草稿索引格式');
  var id=ObjC.unwrap($.NSUUID.UUID.UUIDString),name=meta.draft_name.replace(/[/:]/g,'_'),target=root+'/'+name+'_'+id.slice(0,8),old=meta.draft_fold_path.replace(/\/$/,'');
  function rewrite(v){
    if(typeof v==='string')return v===old||v.indexOf(old+'/')===0?target+v.slice(old.length):v;
    if(Array.isArray(v))return v.map(rewrite);
    if(v&&typeof v==='object')Object.keys(v).forEach(function(k){v[k]=rewrite(v[k]);});return v;
  }
  if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(target),false,$.NSDictionary.dictionary,null))throw Error('无法创建新草稿');
  try{
    copy(pkg+'/Resources',target+'/Resources');
    ['draft_info.json','draft_content.json','draft_meta_info.json'].forEach(function(file){
      var d=rewrite(JSON.parse(read(pkg+'/'+file)));
      if(file==='draft_meta_info.json'){d.draft_id=id;d.draft_fold_path=target;d.draft_root_path=root;}else d.id=id;
      write(target+'/'+file,JSON.stringify(d));
    });
    var now=Date.now()*1000;
    reg.all_draft_store.unshift({draft_id:id,draft_name:name,draft_fold_path:target,draft_root_path:root,draft_json_file:target+'/draft_info.json',draft_cover:target+'/draft_cover.jpg',draft_is_invisible:false,draft_is_cloud_temp_draft:false,cloud_draft_sync:false,streaming_edit_draft_ready:true,draft_type:'',draft_new_version:'',tm_draft_create:now,tm_draft_modified:now,tm_draft_removed:0,tm_duration:content.duration,draft_timeline_materials_size:meta.draft_timeline_materials_size_||0});
    if(Array.isArray(reg.draft_ids))reg.draft_ids.push(id);else if(typeof reg.draft_ids==='number')reg.draft_ids++;
    if(read(rf)!==before)throw Error('剪映正在更新索引，请退出剪映后重试');
    copy(rf,rf+'.'+id+'.bak');write(rf,JSON.stringify(reg));
    return '导入完成：'+name+'。请打开剪映首页。';
  }catch(e){fm.removeItemAtPathError($(target),null);throw e;}
}

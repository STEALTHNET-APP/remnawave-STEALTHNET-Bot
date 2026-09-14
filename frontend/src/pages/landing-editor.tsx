<<<<<<< HEAD
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUp, ArrowDown, Plus, Eye, EyeOff, Save, Trash2, RotateCcw, History, Globe, Loader2, Palette, Layers, Copy, Monitor, Smartphone, Tablet, X, Check, Upload, Download, Settings2, Type, PanelLeftClose, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
=======
/**
 * Редактор лендинга — Phase 3 (MVP):
 * - список блоков (видимость, реордер кнопками, выбор для редактирования)
 * - drawer с raw-JSON редактированием props и i18n
 * - Publish-all / Discard-all-drafts
 * - Создание блока (выбор type)
 * - Список снапшотов с restore (в модальном окне)
 *
 * Live-preview iframe и автогенерация формы по schema — Phase 4/5.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { qk } from "@/lib/query-client";
import {
  useAdminLandingBlocks,
  useAdminLandingDraftsStatus,
  useAdminLandingStatus,
  useAdminLandingSnapshots,
} from "@/lib/admin-queries";
import { Link } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Eye,
  Save,
  Trash2,
  RotateCcw,
  Camera,
  History,
  CheckCircle2,
  AlertCircle,
  Globe,
  Loader2,
  Palette,
  Code,
  FormInput,
  Sparkles,
  Star,
  Award,
  BarChart3,
  Tag,
  Monitor,
  HelpCircle,
  Megaphone,
  Layers,
  ImageIcon,
  MessageSquare,
  Video,
  Minus,
  GripVertical,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  landingEditorApi,
  type AdminLandingBlock,
} from "@/lib/landing-editor-api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)
import { SchemaForm } from "@/components/landing-editor/schema-form";
import { getBlockSchema, BLOCK_SCHEMAS, SECTION_FIELDS, BRAND_FIELDS, type FieldSchema } from "@/components/landing-editor/block-schemas";
import { landingEditorApi, type AdminLandingBlock, type AdminLandingTheme, type AdminLandingSnapshot } from "@/lib/landing-editor-api";
import { STUDIO_PRESETS } from "@/components/landing-studio/presets";
import type { LandingApiResponse } from "@/components/landing-blocks/types";
import "@/components/landing-studio/editor.css";
const object = (v:unknown):Record<string,unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
const clean = (v:unknown) => { const {__landingEditor: _metadata,...rest}=object(v); return rest; };
const label = (b:AdminLandingBlock) => b.type === "custom" ? BLOCK_SCHEMAS.custom.variants.find(v=>v.value===b.variant)?.label ?? "Секция" : BLOCK_SCHEMAS[b.type]?.label ?? b.type;
const THEME_FIELDS: FieldSchema[] = [
 {key:"primaryColor",label:"Главный акцент и кнопки",type:"color"},{key:"accentColor",label:"Дополнительный акцент",type:"color"},{key:"backgroundColor",label:"Фон страницы",type:"color"},{key:"textColor",label:"Основной текст",type:"color"},
 {key:"fontFamily",label:"Шрифт",type:"select",options:["Onest","Manrope","Inter","Geist","IBM Plex Sans"].map(value=>({value,label:value}))},
 {key:"borderRadius",label:"Скругления",type:"select",options:[{value:"0px",label:"Прямые углы"},{value:"6px",label:"Небольшие · 6 px"},{value:"12px",label:"Мягкие · 12 px"},{value:"16px",label:"Округлые · 16 px"}]},
 {key:"containerWidth",label:"Ширина страницы",type:"select",options:[{value:"1200px",label:"Компактная · 1200 px"},{value:"1360px",label:"Средняя · 1360 px"},{value:"1440px",label:"Широкая · 1440 px"},{value:"1680px",label:"Очень широкая · 1680 px"}]},
 {key:"customCss",label:"Дополнительный CSS",type:"textarea",rows:6,hint:"Для разработчиков. Применяется только на лендинге; используйте .sn-landing в селекторах."},
];
export function LandingEditorPage() {
<<<<<<< HEAD
 const {state}=useAuth();const token=state.accessToken;
 const [blocks,setBlocks]=useState<AdminLandingBlock[]>([]),[theme,setTheme]=useState<Record<string,unknown>>({}),[baseTheme,setBaseTheme]=useState<AdminLandingTheme|null>(null);
 const [selected,setSelected]=useState(""),[tab,setTab]=useState<"content"|"style">("content"),[panel,setPanel]=useState<"blocks"|"theme"|"brand">("blocks");
 const [dirty,setDirty]=useState<Set<string>>(new Set()),[themeDirty,setThemeDirty]=useState(false),[pending,setPending]=useState(false),[enabled,setEnabled]=useState(true);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const [width,setWidth]=useState(1440),[language,setLanguage]=useState("ru"),[addOpen,setAddOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[snapshots,setSnapshots]=useState<AdminLandingSnapshot[]>([]);
 const [inspector,setInspector]=useState(true),[previewKey,setPreviewKey]=useState(0),[zoom,setZoom]=useState(1);
 const frame=useRef<HTMLIFrameElement>(null),canvas=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null);
 const busyRef=useRef(false);
 const reload=useCallback(async()=>{if(!token)return;const [b,t,status,e]=await Promise.all([landingEditorApi.listBlocks(token),landingEditorApi.getTheme(token),landingEditorApi.draftsStatus(token),landingEditorApi.getStatus(token)]);
   setBlocks(b);setBaseTheme(t);setTheme({...t,...object(t.draft)});setPending(status.hasBlockDrafts||status.hasThemeDraft);setEnabled(e.enabled);setDirty(new Set());setThemeDirty(false);setSelected(s=>b.some(x=>x.id===s)?s:b[0]?.id??"");
 },[token]);
 useEffect(()=>{reload().catch(e=>setError(String(e))).finally(()=>setLoading(false));},[reload]);
 const hasLocal=dirty.size>0||themeDirty;
 useEffect(()=>{const protect=(e:BeforeUnloadEvent)=>{if(hasLocal){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",protect);return()=>window.removeEventListener("beforeunload",protect);},[hasLocal]);
 const block=blocks.find(b=>b.id===selected);const hero=blocks.find(b=>b.type==="hero");
 const schema=block?getBlockSchema(block.type,block.variant):null;
 const localized=(b:AdminLandingBlock)=>{const all=object(b.i18nDraft??b.i18n);return object(all[language]??all.ru??all.en);};
 const preview=useMemo<LandingApiResponse>(()=>({lang:language,theme:{...theme,fontPresets:(baseTheme?.fontPresets??[])},blocks:blocks.filter(b=>b.visible).map(b=>({id:b.id,type:b.type,variant:b.variant,order:b.order,props:clean(b.propsDraft??b.props),text:localized(b)}))}),[blocks,theme,baseTheme,language]);
 const sendPreview=useCallback(()=>frame.current?.contentWindow?.postMessage({type:"stealthnet-landing:preview",data:preview},location.origin),[preview]);
 useEffect(()=>{const timer=setTimeout(sendPreview,100);return()=>clearTimeout(timer);},[sendPreview]);
 useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin!==location.origin||e.source!==frame.current?.contentWindow)return;if(e.data?.type==="stealthnet-landing:ready")sendPreview();if(e.data?.type==="stealthnet-landing:edit-block"&&typeof e.data.id==="string"){setSelected(e.data.id);setPanel("blocks");setInspector(true);}};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive);},[sendPreview]);
 useEffect(()=>{const node=canvas.current;if(!node)return;const observer=new ResizeObserver(()=>setZoom(Math.min(1,(node.clientWidth-32)/width)));observer.observe(node);return()=>observer.disconnect();},[width,loading,inspector]);
 const changeBlock=(id:string,update:Partial<AdminLandingBlock>)=>{setBlocks(bs=>bs.map(b=>b.id===id?{...b,...update}:b));setDirty(d=>new Set([...d,id]));};
 const changeProps=(b:AdminLandingBlock,value:Record<string,unknown>)=>changeBlock(b.id,{propsDraft:value});
 const changeText=(b:AdminLandingBlock,value:Record<string,unknown>)=>changeBlock(b.id,{i18nDraft:{...object(b.i18nDraft??b.i18n),[language]:value}});
 const saveLocal=async()=>{if(!token)return;for(const b of blocks.filter(b=>dirty.has(b.id)))await landingEditorApi.updateBlock(token,b.id,{propsDraft:clean(b.propsDraft??b.props),i18nDraft:b.i18nDraft??b.i18n,visible:b.visible,variant:b.variant,order:b.order});if(themeDirty){const {id:_id,draft:_draft,updatedAt:_updated,...settings}=theme;await landingEditorApi.updateThemeDraft(token,settings);}};
 const run=async(action:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");setMessage("");try{await action();}catch(e){setError(String(e));}finally{busyRef.current=false;setBusy(false);}};
 const save=()=>run(async()=>{await saveLocal();await reload();setMessage("Черновик сохранён. Сайт изменится после публикации.");});
 const publish=()=>run(async()=>{if(!token)return;await saveLocal();await landingEditorApi.publishAll(token);await reload();setMessage("Лендинг опубликован");});
 const discard=()=>{if(!confirm("Отменить все неопубликованные изменения страницы?"))return;void run(async()=>{if(!token)return;await landingEditorApi.discardAllDrafts(token);await reload();setPreviewKey(k=>k+1);setMessage("Вернулись к опубликованной версии");});};
 const move=(id:string,by:number)=>{const from=blocks.findIndex(b=>b.id===id),to=from+by;if(to<0||to>=blocks.length)return;const next=[...blocks];[next[from],next[to]]=[next[to],next[from]];setBlocks(next.map((b,i)=>({...b,order:(i+1)*10})));setDirty(new Set([...dirty,...next.map(b=>b.id)]));};
 const create=(type:string,variant:string,copy?:AdminLandingBlock)=>run(async()=>{if(!token)return;await saveLocal();const b=await landingEditorApi.createBlock(token,{type,variant,...(copy?{props:clean(copy.propsDraft??copy.props),i18n:copy.i18nDraft??copy.i18n}:{})});await reload();setSelected(b.id);setPanel("blocks");setInspector(true);setAddOpen(false);setMessage(copy?"Копия добавлена в черновик":"Секция добавлена в черновик");});
 const remove=(b:AdminLandingBlock)=>{if(!confirm(`Убрать секцию «${label(b)}»? На сайте она исчезнет после публикации.`))return;void run(async()=>{if(!token)return;await saveLocal();await landingEditorApi.deleteBlock(token,b.id);await reload();setMessage("Секция убрана из черновика");});};
 const history=()=>run(async()=>{if(!token)return;setSnapshots(await landingEditorApi.listSnapshots(token));setHistoryOpen(true);});
 const snapshot=()=>run(async()=>{if(!token)return;await saveLocal();await landingEditorApi.createSnapshot(token,`Ручная копия · ${new Date().toLocaleString("ru-RU")}`);await reload();setMessage("Копия страницы сохранена в истории");});
 const applyPreset=(preset:typeof STUDIO_PRESETS[number])=>{setTheme(t=>({...t,...preset.theme}));setThemeDirty(true);if(hero)changeProps(hero,{...clean(hero.propsDraft??hero.props),...preset.scene});setMessage(`Оформление ${preset.name} применено к черновику. Тексты сохранены.`);};
 const exportPage=()=>{const payload={format:"stealthnet-landing",version:1,theme,blocks:blocks.map(b=>({type:b.type,variant:b.variant,visible:b.visible,props:clean(b.propsDraft??b.props),i18n:b.i18nDraft??b.i18n}))};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="landing-template.json";a.click();URL.revokeObjectURL(url);};
 const importPage=async(f:File)=>{try{if(f.size>2*1024*1024)throw new Error("Шаблон должен быть меньше 2 МБ");const data=JSON.parse(await f.text());if(data.format!=="stealthnet-landing"||data.version!==1||!Array.isArray(data.blocks)||data.blocks.length>100||data.blocks.some((b:AdminLandingBlock)=>!BLOCK_SCHEMAS[b.type]||!getBlockSchema(b.type,b.variant)))throw new Error("Неподдерживаемый файл шаблона");if(!confirm("Заменить черновик страницы импортированным шаблоном? Текущая версия будет сохранена в истории."))return;await run(async()=>{if(!token)return;await saveLocal();await landingEditorApi.createSnapshot(token,"Перед импортом шаблона");for(const b of blocks)await landingEditorApi.deleteBlock(token,b.id);for(const b of data.blocks)await landingEditorApi.createBlock(token,{type:b.type,variant:b.variant,props:clean(b.props),i18n:object(b.i18n),visible:b.visible!==false});const keys=THEME_FIELDS.map(f=>f.key);await landingEditorApi.updateThemeDraft(token,Object.fromEntries(Object.entries(object(data.theme)).filter(([k])=>keys.includes(k))));await reload();setMessage("Шаблон импортирован в черновик. Проверьте изображения и ссылки перед публикацией.");});}catch(e){setError(String(e));}finally{if(file.current)file.current.value="";}};
 if(loading)return <div className="p-12 flex justify-center gap-3" role="status"><Loader2 className="animate-spin"/>Загружаем конструктор…</div>;
 return <div className="sn-editor">
  <header className="sn-editor-toolbar"><div className="sn-editor-title"><a href="/admin/settings" aria-label="Вернуться в настройки"><ArrowLeft size={20}/></a><div><h1>Конструктор лендинга</h1><span>{hasLocal?"Есть несохранённые изменения":pending?"Черновик · готов к публикации":"Все изменения опубликованы"}</span></div></div><div className="sn-editor-tools"><button disabled={busy} onClick={()=>void run(async()=>{if(!token)return;const e=await landingEditorApi.setStatus(token,!enabled);setEnabled(e.enabled);})} className={enabled?"sn-enabled":""} title="Включение и выключение сайта применяется сразу"><span/>{enabled?"Сайт включён":"Сайт выключен"}</button><button title="История версий" disabled={busy} onClick={history}><History size={17}/><span>История</span></button><button title="Сохранить черновик" disabled={busy||!hasLocal} onClick={save}><Save size={17}/><span>Сохранить</span></button><button className="sn-editor-publish" disabled={busy||(!pending&&!hasLocal)} onClick={publish}>{busy?<Loader2 size={17} className="animate-spin"/>:<Check size={17}/>}Опубликовать</button></div></header>
  {(error||message)&&<div className={error?"sn-editor-notice sn-editor-error":"sn-editor-notice"} role={error?"alert":"status"}>{error||message}<button aria-label="Закрыть сообщение" onClick={()=>{setMessage("");setError("");}}><X size={15}/></button></div>}
  <fieldset disabled={busy} className="sn-editor-workspace">
   <aside className="sn-editor-sidebar"><div className="sn-editor-modes"><button className={panel==="blocks"?"active":""} onClick={()=>{setPanel("blocks");setInspector(true);}}><Layers size={17}/>Секции</button><button className={panel==="theme"?"active":""} onClick={()=>{setPanel("theme");setInspector(true);}}><Palette size={17}/>Стиль</button><button className={panel==="brand"?"active":""} onClick={()=>{setPanel("brand");setInspector(true);}}><Globe size={17}/>Бренд</button></div>
   <div className="sn-sidebar-heading"><strong>Структура страницы</strong><span>{blocks.length}</span></div>
   <div className="sn-block-list">{blocks.map((b,i)=><div key={b.id} className={`sn-block-row ${selected===b.id&&panel==="blocks"?"active":""} ${!b.visible?"is-hidden":""}`}><button className="sn-block-name" onClick={()=>{setSelected(b.id);setPanel("blocks");setInspector(true);}}><span className="sn-block-icon">{b.type==="hero"?<Globe size={17}/>:b.type==="tariffs"?<Layers size={17}/>:<Type size={17}/>}</span><span>{label(b)}</span>{(dirty.has(b.id)||b.propsDraft||b.i18nDraft)&&<i title="Изменено в черновике"/>}</button><button aria-label={b.visible?`Скрыть ${label(b)}`:`Показать ${label(b)}`} onClick={()=>changeBlock(b.id,{visible:!b.visible})}>{b.visible?<Eye size={14}/>:<EyeOff size={14}/>}</button><div className="sn-block-order"><button aria-label={`Поднять ${label(b)}`} disabled={i===0} onClick={()=>move(b.id,-1)}><ArrowUp size={12}/></button><button aria-label={`Опустить ${label(b)}`} disabled={i===blocks.length-1} onClick={()=>move(b.id,1)}><ArrowDown size={12}/></button></div></div>)}</div>
   <button className="sn-add-section" onClick={()=>setAddOpen(true)} disabled={busy}><Plus size={17}/>Добавить секцию</button>
   <div className="sn-sidebar-bottom"><p>Настраивайте страницу в черновике. Посетители увидят её после публикации.</p><div><button onClick={snapshot} disabled={busy}><Copy size={14}/>Создать копию</button><button onClick={discard} disabled={busy||(!hasLocal&&!pending)}><RotateCcw size={14}/>Отменить</button></div><div><button onClick={exportPage}><Download size={14}/>Экспорт</button><button onClick={()=>file.current?.click()} disabled={busy}><Upload size={14}/>Импорт</button></div><input ref={file} type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importPage(f);}}/></div></aside>
   <div className="sn-editor-canvas-column"><div className="sn-preview-toolbar"><div className="sn-device-switch">{[{w:1440,icon:Monitor,label:"Компьютер"},{w:768,icon:Tablet,label:"Планшет"},{w:390,icon:Smartphone,label:"Телефон"}].map(({w,icon:Icon,label})=><button key={w} aria-label={label} title={label} aria-pressed={width===w} className={width===w?"active":""} onClick={()=>setWidth(w)}><Icon size={17}/></button>)}</div><span>{width} px · {Math.round(zoom*100)}%</span><div className="sn-preview-right"><a href="/" target="_blank" rel="noreferrer" title="Открыть опубликованный сайт"><ExternalLink size={16}/></a><button onClick={()=>setInspector(!inspector)} aria-label={inspector?"Скрыть настройки":"Показать настройки"}><PanelLeftClose size={17}/></button></div></div><div className="sn-editor-canvas" ref={canvas}><div className="sn-preview-scaled" style={{width:width*zoom,height:Math.max(700,900*zoom)}}><iframe key={previewKey} ref={frame} src="/admin/landing-preview" title="Предпросмотр лендинга" onLoad={sendPreview} style={{width,height:Math.max(900,760/Math.max(zoom,.2)),transform:`scale(${zoom})`}}/></div></div><div className="sn-preview-caption"><Eye size={13}/>Предпросмотр · нажмите «Редактировать секцию» на странице</div></div>
   {inspector&&<aside className="sn-editor-inspector"><div className="sn-inspector-heading"><div><span>{panel==="theme"?"Оформление страницы":panel==="brand"?"Ваш бренд":"Настройки секции"}</span><h2>{panel==="theme"?"Стиль и цвета":panel==="brand"?"Бренд и навигация":block?label(block):"Выберите секцию"}</h2></div><button onClick={()=>setInspector(false)} aria-label="Закрыть настройки"><X size={17}/></button></div>
   <div className="sn-inspector-body">{panel==="theme"?<><div className="sn-presets">{STUDIO_PRESETS.map(p=><button key={p.id} onClick={()=>applyPreset(p)}><span style={{background:p.theme.backgroundColor,color:p.theme.textColor}}><span style={{background:p.theme.primaryColor}}/><b>Aa</b></span><strong>{p.name}</strong><small>{p.description}</small></button>)}</div><SchemaForm fields={THEME_FIELDS} value={theme} onChange={v=>{setTheme(v);setThemeDirty(true);}}/></>:panel==="brand"?hero?<SchemaForm fields={BRAND_FIELDS} value={{showHeader:true,stickyHeader:true,...clean(hero.propsDraft??hero.props)}} onChange={v=>changeProps(hero,v)}/>:<p>Добавьте главный экран, чтобы настроить бренд и навигацию.</p>:block&&schema?<>
     <div className="sn-inspector-tabs"><button className={tab==="content"?"active":""} onClick={()=>setTab("content")}><Type size={15}/>Содержимое</button><button className={tab==="style"?"active":""} onClick={()=>setTab("style")}><Settings2 size={15}/>Оформление</button></div>
     {tab==="content"?<><div className="sn-language"><label htmlFor="landing-language">Язык текстов</label><select id="landing-language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="ru">Русский</option><option value="en">English</option></select></div><SchemaForm fields={schema.i18nFields} value={localized(block)} onChange={v=>changeText(block,v)}/>{schema.propsFields.filter(f=>["items","steps","links","offerLink","privacyLink"].includes(f.key)).length>0&&<div className="sn-inspector-group"><SchemaForm fields={schema.propsFields.filter(f=>["items","steps","links","offerLink","privacyLink"].includes(f.key))} value={clean(block.propsDraft??block.props)} onChange={v=>changeProps(block,v)}/></div>}</>:<><SchemaForm fields={schema.propsFields.filter(f=>!["items","steps","links","offerLink","privacyLink"].includes(f.key))} value={block.type==="hero"?{sceneType:"spatial",sceneColor:"#a0a3ff",sceneMaterial:"glass",sceneMotion:true,sceneSpeed:1,showSecondary:true,showRightCard:true,...clean(block.propsDraft??block.props)}:clean(block.propsDraft??block.props)} onChange={v=>changeProps(block,v)}/><details className="sn-section-options" open><summary>Фон, размеры и видимость</summary><SchemaForm fields={SECTION_FIELDS} value={clean(block.propsDraft??block.props)} onChange={v=>changeProps(block,v)}/></details></>}
     <div className="sn-block-actions"><Button variant="outline" size="sm" disabled={busy} onClick={()=>create(block.type,block.variant,block)}><Copy size={14}/>Дублировать</Button><Button variant="outline" size="sm" disabled={busy} onClick={()=>remove(block)}><Trash2 size={14}/>Удалить</Button></div>
   </>:<p>Выберите секцию слева или добавьте новую.</p>}</div></aside>}
  </fieldset>
  {addOpen&&<StudioDialog onClose={()=>setAddOpen(false)} labelledBy="add-section-title"><div className="sn-dialog-heading"><h2 id="add-section-title">Добавить секцию</h2><button aria-label="Закрыть" onClick={()=>setAddOpen(false)}><X/></button></div><div className="sn-section-library">{Object.values(BLOCK_SCHEMAS).flatMap(s=>s.variants.map(v=><button key={`${s.type}/${v.value}`} disabled={busy} onClick={()=>create(s.type,v.value)}><span className={`sn-section-mini sn-section-mini-${s.type}`}><i/><i/><i/></span><strong>{s.type==="custom"?v.label:s.label}</strong><p>{s.type==="custom"?v.label:v.label+" · "+s.description}</p><span>Добавить <Plus size={14}/></span></button>))}</div></StudioDialog>}
  {historyOpen&&<StudioDialog onClose={()=>setHistoryOpen(false)} labelledBy="history-title"><div className="sn-dialog-heading"><h2 id="history-title">История страницы</h2><button aria-label="Закрыть" onClick={()=>setHistoryOpen(false)}><X/></button></div><p className="sn-history-hint">Перед публикацией автоматически создаётся копия. Восстановление сразу меняет опубликованный сайт.</p>{snapshots.length===0?<p>Сохранённых версий пока нет.</p>:snapshots.map(s=><div key={s.id} className="sn-history-row"><div><strong>{s.label?.replace("auto-before-publish","Перед публикацией").replace("auto-before-restore","Перед восстановлением")||"Сохранённая версия"}</strong><small>{new Date(s.createdAt).toLocaleString("ru-RU")}</small></div><button disabled={busy} onClick={()=>{if(!confirm("Восстановить эту версию на сайте? Текущая версия будет сохранена в истории."))return;void run(async()=>{if(!token)return;await landingEditorApi.restoreSnapshot(token,s.id);await reload();setHistoryOpen(false);setMessage("Версия восстановлена");});}}>Восстановить</button></div>)}</StudioDialog>}
 </div>;
=======
  const { state } = useAuth();
  const token = state.accessToken;

  const queryClient = useQueryClient();

  const blocksQ = useAdminLandingBlocks(token);
  const draftsQ = useAdminLandingDraftsStatus(token);
  const landingStatusQ = useAdminLandingStatus(token);
  const blocks = blocksQ.data ?? [];
  const drafts = draftsQ.data ?? { hasBlockDrafts: false, hasThemeDraft: false };
  const landingEnabled = landingStatusQ.data?.enabled ?? true;
  const loading = blocksQ.isLoading;
  const error = !blocksQ.isError ? null : (blocksQ.error instanceof Error ? blocksQ.error.message : String(blocksQ.error));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // reload() = invalidate admin-landing ключей + перезагрузка iframe-превью.
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "landing"], exact: false });
    setPreviewKey((k) => k + 1);
  }, []);

  // Click-to-edit: iframe-превью посылает {type: 'stealthnet-landing:edit-block', id}.
  // Селектим соответствующий блок в редакторе.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as { type?: string; id?: string };
      if (msg?.type === "stealthnet-landing:edit-block" && typeof msg.id === "string") {
        setSelectedId(msg.id);
        // Открываем форму если превью занимает весь правый край (иначе пользователь не увидит).
        if (!previewVisible) setPreviewVisible(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewVisible]);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? null, [blocks, selectedId]);

  // ── Мутации ──
  const toggleVisibleMutation = useMutation({
    mutationFn: (vars: { id: string; visible: boolean }) =>
      landingEditorApi.updateBlock(token!, vars.id, { visible: vars.visible }),
    onSuccess: reload,
    onError: (e) => showToast("err", String(e)),
  });
  const handleToggleVisible = (id: string, visible: boolean) => {
    if (!token) return;
    toggleVisibleMutation.mutate({ id, visible });
  };

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; order: number }[]) => landingEditorApi.reorderBlocks(token!, items),
    onSuccess: reload,
    onError: (e) => showToast("err", String(e)),
  });

  const handleReorder = (id: string, direction: "up" | "down") => {
    if (!token) return;
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= blocks.length) return;

    // Свопаем order у двух блоков
    const a = blocks[idx];
    const b = blocks[target];
    reorderMutation.mutate([
      { id: a.id, order: b.order },
      { id: b.id, order: a.order },
    ]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!token) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(blocks, oldIndex, newIndex);
    // Оптимистично обновляем UI.
    queryClient.setQueryData(qk.admin.landingBlocks(), next);
    // Назначаем новые order'ы сериями по 10 для удобства будущих вставок.
    reorderMutation.mutate(next.map((b, i) => ({ id: b.id, order: (i + 1) * 10 })));
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const deleteBlockMutation = useMutation({
    mutationFn: (id: string) => landingEditorApi.deleteBlock(token!, id),
    onSuccess: (_d, id) => {
      if (selectedId === id) setSelectedId(null);
      reload();
      showToast("ok", "Блок удалён");
    },
    onError: (e) => showToast("err", String(e)),
  });

  const handleDelete = (id: string) => {
    if (!token) return;
    if (!confirm("Удалить блок? Будет создан авто-снапшот при следующем Publish.")) return;
    deleteBlockMutation.mutate(id);
  };

  const addBlockMutation = useMutation({
    mutationFn: (vars: { type: string; variant: string }) =>
      landingEditorApi.createBlock(token!, { type: vars.type, variant: vars.variant, props: {}, i18n: { ru: {} } }),
    onSuccess: (created, vars) => {
      reload();
      setSelectedId(created.id);
      setAddOpen(false);
      showToast("ok", `Блок ${vars.type}/${vars.variant} добавлен`);
    },
    onError: (e) => showToast("err", String(e)),
  });

  const handleAddBlock = (type: string, variant: string) => {
    if (!token) return;
    addBlockMutation.mutate({ type, variant });
  };

  const publishAllMutation = useMutation({
    mutationFn: () => landingEditorApi.publishAll(token!),
    onSuccess: (result) => {
      reload();
      showToast("ok", `Опубликовано: ${result.publishedBlocks} блоков, тема: ${result.themePublished ? "да" : "нет"}`);
    },
    onError: (e) => showToast("err", String(e)),
  });

  const handlePublishAll = () => {
    if (!token) return;
    if (!confirm("Опубликовать все черновики? Будет создан авто-снапшот.")) return;
    publishAllMutation.mutate();
  };

  const discardAllMutation = useMutation({
    mutationFn: () => landingEditorApi.discardAllDrafts(token!),
    onSuccess: () => {
      reload();
      showToast("ok", "Черновики отброшены");
    },
    onError: (e) => showToast("err", String(e)),
  });

  const handleDiscardAll = () => {
    if (!token) return;
    if (!confirm("Отбросить все черновики? Действие необратимо.")) return;
    discardAllMutation.mutate();
  };

  const manualSnapshotMutation = useMutation({
    mutationFn: (label?: string) => landingEditorApi.createSnapshot(token!, label),
    onSuccess: () => showToast("ok", "Снапшот создан"),
    onError: (e) => showToast("err", String(e)),
  });

  const busy =
    publishAllMutation.isPending || discardAllMutation.isPending || manualSnapshotMutation.isPending;

  const handleManualSnapshot = () => {
    if (!token) return;
    const label = prompt("Название снапшота (можно пустое):", "manual");
    if (label === null) return;
    manualSnapshotMutation.mutate(label || undefined);
  };

  // Переключение лендинга вкл/выкл.
  const setStatusMutation = useMutation({
    mutationFn: (next: boolean) => landingEditorApi.setStatus(token!, next),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.admin.landingStatus() });
      showToast("ok", result.enabled ? "Лендинг включён" : "Лендинг выключен");
    },
    onError: (e) => showToast("err", String(e)),
  });

  const handleToggleLanding = (next: boolean) => {
    if (!token) return;
    if (!next && !confirm("Выключить лендинг? Корень сайта будет редиректить в /cabinet.")) return;
    setStatusMutation.mutate(next);
  };

  const publishBlockMutation = useMutation({
    mutationFn: (id: string) => landingEditorApi.publishBlock(token!, id),
    onSuccess: reload,
    onError: () => undefined, // тост показывает вызывающий колбэк
  });

  const discardBlockMutation = useMutation({
    mutationFn: (id: string) => landingEditorApi.discardBlockDraft(token!, id),
    onSuccess: reload,
    onError: () => undefined,
  });

  const applyDefaultsMutation = useMutation({
    mutationFn: (vars: { id: string; mode: "merge" | "overwrite" }) =>
      landingEditorApi.applyBlockDefaults(token!, vars.id, vars.mode),
    onSuccess: reload,
    onError: () => undefined,
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Toast */}
      {toast ? (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            toast.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
              : "border-red-500/30 bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-100"
          }`}
        >
          {toast.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.text}
        </div>
      ) : null}

      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/settings" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Настройки
              </Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <Globe className="h-5 w-5 text-emerald-500" />
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Редактор лендинга</h1>
            <div className="ml-2 flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1">
              <Switch checked={landingEnabled} onCheckedChange={handleToggleLanding} />
              <span className={`text-xs font-medium ${landingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {landingEnabled ? "Лендинг включён" : "Лендинг выключен"}
              </span>
            </div>
            {(drafts.hasBlockDrafts || drafts.hasThemeDraft) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <AlertCircle className="h-3 w-3" />
                Есть черновики
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setPreviewVisible((v) => !v)} variant={previewVisible ? "default" : "outline"} size="sm" className="gap-1.5">
              <Eye className="h-4 w-4" />
              {previewVisible ? "Скрыть превью" : "Превью"}
            </Button>
            <Button onClick={() => setThemeOpen(true)} variant="outline" size="sm" className="gap-1.5">
              <Palette className="h-4 w-4" />
              Тема
            </Button>
            <Button onClick={handleManualSnapshot} variant="outline" size="sm" className="gap-1.5" disabled={busy}>
              <Camera className="h-4 w-4" />
              Снапшот
            </Button>
            <Button onClick={() => setSnapshotsOpen(true)} variant="outline" size="sm" className="gap-1.5">
              <History className="h-4 w-4" />
              История
            </Button>
            <div className="h-6 w-px bg-border" />
            <Button
              onClick={handleDiscardAll}
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy || !drafts.hasBlockDrafts}
            >
              <RotateCcw className="h-4 w-4" />
              Отбросить
            </Button>
            <Button
              onClick={handlePublishAll}
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy || (!drafts.hasBlockDrafts && !drafts.hasThemeDraft)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Опубликовать
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950/50 dark:text-red-100">
            Ошибка загрузки: {error}
          </div>
        ) : (
          <div className={`grid gap-6 ${previewVisible ? "lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,1.1fr)]" : "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"}`}>
            {/* Block list */}
            <Card>
              <CardContent className="p-3">
                <div className="mb-3 flex items-center justify-between px-2">
                  <Label className="text-sm font-semibold">Блоки лендинга ({blocks.length})</Label>
                  <Button onClick={() => setAddOpen(true)} size="sm" variant="ghost" className="h-8 gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </Button>
                </div>
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5">
                      {blocks.map((b, idx) => (
                        <SortableBlockRow
                          key={b.id}
                          block={b}
                          isFirst={idx === 0}
                          isLast={idx === blocks.length - 1}
                          isSelected={selectedId === b.id}
                          onSelect={() => setSelectedId(b.id)}
                          onMoveUp={() => handleReorder(b.id, "up")}
                          onMoveDown={() => handleReorder(b.id, "down")}
                          onToggleVisible={(v) => handleToggleVisible(b.id, v)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>

            {/* Editor */}
            <Card className="min-w-0">
              <CardContent className="p-4">
                {!selected ? (
                  <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
                    <Eye className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <h3 className="text-[13.5px] font-bold">Выберите блок слева</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Каждый блок редактируется как JSON. После Publish — изменения видны на лендинге.
                      </p>
                    </div>
                  </div>
                ) : (
                  <BlockEditor
                    key={selected.id}
                    block={selected}
                    onSaved={() => {
                      reload();
                      showToast("ok", "Сохранено в черновик");
                    }}
                    onError={(e) => showToast("err", e)}
                    onDelete={() => handleDelete(selected.id)}
                    onPublishOne={() =>
                      publishBlockMutation.mutateAsync(selected.id)
                        .then(() => showToast("ok", "Блок опубликован"))
                        .catch((e) => showToast("err", String(e)))
                    }
                    onDiscardOne={() =>
                      discardBlockMutation.mutateAsync(selected.id)
                        .then(() => showToast("ok", "Черновик отброшен"))
                        .catch((e) => showToast("err", String(e)))
                    }
                    onApplyDefaults={(mode) =>
                      applyDefaultsMutation.mutateAsync({ id: selected.id, mode })
                        .then(() => showToast("ok", "Дефолты применены в черновик. Жми «Опубликовать», чтобы сохранить."))
                        .catch((e) => showToast("err", String(e)))
                    }
                  />
                )}
              </CardContent>
            </Card>

            {/* Live preview iframe */}
            {previewVisible ? (
              <Card className="min-w-0 overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="font-medium">Превью лендинга (с черновиками)</span>
                    </div>
                    <Button
                      onClick={() => setPreviewKey((k) => k + 1)}
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      title="Обновить"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Обновить
                    </Button>
                  </div>
                  <iframe
                    key={previewKey}
                    src="/admin/landing-preview"
                    title="Landing preview"
                    className="block h-[calc(100vh-200px)] w-full bg-background"
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>

      {/* Add Block dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить блок</DialogTitle>
            <DialogDescription>Выберите тип. Блок будет создан в конце списка с пустыми полями.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 max-h-[60vh] overflow-y-auto py-1">
            {ADDABLE_BLOCKS.map((bt) => {
              const Icon = ICON_MAP[bt.iconName] ?? Layers;
              return (
                <button
                  key={`${bt.type}/${bt.variant}`}
                  onClick={() => handleAddBlock(bt.type, bt.variant)}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/30"
                >
                  <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{bt.label}</div>
                    {bt.description ? <div className="mt-0.5 text-xs text-muted-foreground">{bt.description}</div> : null}
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{bt.type}/{bt.variant}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <SnapshotsDialog
        onClose={() => setSnapshotsOpen(false)}
        open={snapshotsOpen}
        onRestored={async () => {
          setSnapshotsOpen(false);
          await reload();
          showToast("ok", "Снапшот восстановлен");
        }}
        onError={(e) => showToast("err", e)}
      />

      <ThemeDialog
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        token={token}
        onChanged={async () => {
          await reload();
        }}
        onError={(e) => showToast("err", e)}
        onSuccess={(m) => showToast("ok", m)}
      />
    </div>
  );
>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)
}

function StudioDialog({children,onClose,labelledBy}:{children:ReactNode;onClose:()=>void;labelledBy:string}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog ref={ref} className="sn-studio-dialog" aria-labelledby={labelledBy} onCancel={onClose} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>{children}</dialog>;
}
<<<<<<< HEAD
=======

function SortableBlockRow({ block, isFirst, isLast, isSelected, onSelect, onMoveUp, onMoveDown, onToggleVisible }: SortableBlockRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const Icon = blockIcon(block.type);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors cursor-pointer ${
        isSelected ? "border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/30" : "border-border hover:bg-accent"
      }`}
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="-ml-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
        title="Перетащить"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex flex-col gap-0.5">
        <Button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={isFirst}>
          <ArrowUp className="h-3 w-3" />
        </Button>
        <Button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={isLast}>
          <ArrowDown className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{blockLabel(block)}</span>
          {hasDraft(block) ? (
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Есть несохранённые изменения" />
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">{blockTechName(block)}</div>
      </div>
      <Switch
        checked={block.visible}
        onCheckedChange={onToggleVisible}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

//  BlockEditor (правый сайд) 

interface BlockEditorProps {
  block: AdminLandingBlock;
  onSaved: () => Promise<void> | void;
  onError: (msg: string) => void;
  onDelete: () => void;
  onPublishOne: () => Promise<void> | void;
  onDiscardOne: () => Promise<void> | void;
  onApplyDefaults: (mode: "merge" | "overwrite") => Promise<void> | void;
}

function BlockEditor({ block, onSaved, onError, onDelete, onPublishOne, onDiscardOne, onApplyDefaults }: BlockEditorProps) {
  const draftedProps = (block.propsDraft ?? block.props) as Record<string, unknown>;
  const draftedI18n = (block.i18nDraft ?? block.i18n) as Record<string, unknown>;

  const schema = getBlockSchema(block.type, block.variant);

  // Form state — структурный.
  const [variant, setVariant] = useState(block.variant);
  const [propsObj, setPropsObj] = useState<Record<string, unknown>>(draftedProps);
  const [i18nRu, setI18nRu] = useState<Record<string, unknown>>(
    typeof draftedI18n.ru === "object" && draftedI18n.ru !== null ? (draftedI18n.ru as Record<string, unknown>) : {},
  );

  // Raw-JSON fallback state (синхронизируется при переключении).
  const [propsText, setPropsText] = useState(() => JSON.stringify(draftedProps, null, 2));
  const [i18nText, setI18nText] = useState(() => JSON.stringify(draftedI18n, null, 2));
  const [propsError, setPropsError] = useState<string | null>(null);
  const [i18nError, setI18nError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "json">(schema ? "form" : "json");


  // Token нужен для PATCH /blocks/:id — берём из useAuth (props API не меняем).
  const { state } = useAuth();
  const token = state.accessToken;

  const drafted = block.propsDraft !== null || block.i18nDraft !== null;

  const saveMutation = useMutation({
    mutationFn: (vars: { finalProps: Record<string, unknown>; finalI18n: Record<string, unknown>; variantChanged: boolean }) =>
      landingEditorApi.updateBlock(token!, block.id, {
        propsDraft: vars.finalProps,
        i18nDraft: vars.finalI18n,
        variant: vars.variantChanged ? variant : undefined,
      }),
    onSuccess: () => onSaved(),
    onError: (e) => onError(String(e)),
  });

  const handleSave = () => {
    let finalProps: Record<string, unknown>;
    let finalI18n: Record<string, unknown>;

    if (mode === "form") {
      finalProps = stripUndefined(propsObj);
      finalI18n = { ru: stripUndefined(i18nRu) };
    } else {
      try {
        finalProps = JSON.parse(propsText);
        setPropsError(null);
      } catch (e) {
        setPropsError(String(e));
        return;
      }
      try {
        finalI18n = JSON.parse(i18nText);
        setI18nError(null);
      } catch (e) {
        setI18nError(String(e));
        return;
      }
    }

    saveMutation.mutate({ finalProps, finalI18n, variantChanged: variant !== block.variant });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {(() => {
            const Icon = ICON_MAP[BLOCK_SCHEMAS[block.type]?.icon ?? ""] ?? Layers;
            return <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />;
          })()}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Блок</div>
            <h2 className="mt-1 text-[13.5px] font-bold">
              {schema?.label ?? block.type}
              {schema && schema.variants.length > 1 ? (
                <span className="text-muted-foreground"> · {schema.variants.find((v) => v.value === variant)?.label ?? variant}</span>
              ) : null}
            </h2>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{block.type}/{variant} · id {block.id.slice(0, 8)}…</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onApplyDefaults("merge")}
            variant="outline"
            size="sm"
            className="gap-1.5"
            title="Заполнить пустые поля стандартными значениями (то, что показывает live-превью). Уже заполненные поля не трогаем."
          >
            <Wand2 className="h-3.5 w-3.5" />
            Стандарт
          </Button>
          {drafted ? (
            <>
              <Button onClick={onDiscardOne} variant="outline" size="sm" className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Отбросить
              </Button>
              <Button onClick={onPublishOne} size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Опубликовать
              </Button>
            </>
          ) : null}
          <Button onClick={onDelete} variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700">
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </Button>
        </div>
      </div>

      {/* Variant select / input */}
      <div>
        <Label htmlFor="variant-input" className="text-sm font-semibold">Variant</Label>
        {schema && schema.variants.length > 1 ? (
          <select
            id="variant-input"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="mt-1.5 flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {schema.variants.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        ) : (
          <Input
            id="variant-input"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="mt-1.5 max-w-xs"
          />
        )}
      </div>

      {/* Mode toggle */}
      <Tabs value={mode} onValueChange={(v) => {
        if (v === "json") {
          // При переключении в JSON синхронизируем тексты.
          setPropsText(JSON.stringify(stripUndefined(propsObj), null, 2));
          setI18nText(JSON.stringify({ ru: stripUndefined(i18nRu) }, null, 2));
        } else {
          // При переключении в форму — парсим JSON если он валидный.
          try {
            const parsed = JSON.parse(propsText);
            setPropsObj(parsed);
            setPropsError(null);
          } catch { /* keep old form state */ }
          try {
            const parsed = JSON.parse(i18nText);
            if (parsed.ru && typeof parsed.ru === "object") setI18nRu(parsed.ru);
            setI18nError(null);
          } catch { /* keep old form state */ }
        }
        setMode(v as "form" | "json");
      }}>
        <TabsList>
          <TabsTrigger value="form" className="gap-1.5">
            <FormInput className="h-3.5 w-3.5" />
            Форма
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <Code className="h-3.5 w-3.5" />
            Raw JSON
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form" className="mt-5 space-y-6">
          {schema ? (
            <>
              <section>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Контент (RU)</h3>
                <SchemaForm fields={schema.i18nFields} value={i18nRu} onChange={setI18nRu} />
              </section>
              <section className="border-t pt-5">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Структура</h3>
                <SchemaForm fields={schema.propsFields} value={propsObj} onChange={setPropsObj} />
              </section>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Schema не найдена для блока {block.type}/{variant}. Используйте Raw JSON.
            </div>
          )}
        </TabsContent>

        <TabsContent value="json" className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">props</Label>
              {propsError ? <span className="text-xs text-red-500">{propsError}</span> : null}
            </div>
            <Textarea value={propsText} onChange={(e) => setPropsText(e.target.value)} rows={10} className="mt-1.5 font-mono text-xs" placeholder="{}" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">i18n</Label>
              {i18nError ? <span className="text-xs text-red-500">{i18nError}</span> : null}
            </div>
            <Textarea value={i18nText} onChange={(e) => setI18nText(e.target.value)} rows={14} className="mt-1.5 font-mono text-xs" placeholder={'{ "ru": { "title": "..." } }'} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-1.5">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить в черновик
        </Button>
      </div>
    </div>
  );
}

/** Убирает undefined и пустые строки чтобы payload был чище. */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

//  Snapshots Dialog 

interface SnapshotsDialogProps {
  open: boolean;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
  onError: (msg: string) => void;
}

function SnapshotsDialog({ open, onClose, onRestored, onError }: SnapshotsDialogProps) {
  const { state } = useAuth();
  const token = state.accessToken;
  const queryClient = useQueryClient();

  const snapshotsQ = useAdminLandingSnapshots(token, open);
  const snapshots = snapshotsQ.data ?? [];
  const loading = snapshotsQ.isLoading && open;

  const restoreMutation = useMutation({
    mutationFn: (id: string) => landingEditorApi.restoreSnapshot(token!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "landing"], exact: false });
      onRestored();
    },
    onError: (e) => onError(String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => landingEditorApi.deleteSnapshot(token!, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.admin.landingSnapshots() }),
    onError: (e) => onError(String(e)),
  });

  const handleRestore = (id: string) => {
    if (!token) return;
    if (!confirm("Восстановить лендинг из этого снапшота? Текущее состояние сохранится как auto-snapshot.")) return;
    restoreMutation.mutate(id);
  };

  const handleDelete = (id: string) => {
    if (!token) return;
    if (!confirm("Удалить снапшот безвозвратно?")) return;
    deleteMutation.mutate(id);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>История снапшотов</DialogTitle>
          <DialogDescription>
            Авто-снапшоты создаются перед каждой публикацией и восстановлением.
            Можно создать ручной снапшот через кнопку «Снапшот» сверху.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Снапшотов пока нет</div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.label ?? "(без названия)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtMsk(s.createdAt)}{s.createdBy ? ` · ${s.createdBy}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button onClick={() => handleRestore(s.id)} size="sm" variant="outline" className="gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Восстановить
                  </Button>
                  <Button onClick={() => handleDelete(s.id)} size="sm" variant="outline" className="gap-1.5 text-red-600 hover:text-red-700">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)

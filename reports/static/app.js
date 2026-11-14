const $ = id => document.getElementById(id);
const labels = {new:'Новая',triage:'Проверяем',in_progress:'В работе',done:'Исправлено',duplicate:'Дубликат',declined:'Закрыто'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value * 1000).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
let mine = location.pathname.startsWith('/mine'), admin = false, page = 1, status = '', generation = 0, currentItems = [], previewUrls = [];
async function api(path, options = {}) {
  const response = await fetch(path, {credentials:'same-origin',...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && admin) { admin = false; $('logout').hidden=true; $('credentials').hidden=false; $('otp').hidden=true; $('login-form').reset(); $('login-form').elements.email.required=true; $('login-form').elements.password.required=true; $('login-form').elements.code.required=false; show('login'); }
    throw new Error(data.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  }
  return data;
}
function show(id) {
  for (const key of ['board','new-report','receipt','login','detail']) $(key).hidden = key !== id;
  $('global-error').textContent = '';
}
function statusBadge(item) { return `<span class="status ${escape(item.status)}">${escape(labels[item.status])}</span>`; }
async function load() {
  const version = ++generation;
  $('rows').textContent = 'Загружаем…';
  $('global-error').textContent = '';
  const params = new URLSearchParams({q:$('search').value,status,page:String(page)});
  if (admin && $('pending-only').checked) params.set('publication','pending');
  $('publication-filter').hidden=!admin;
  $('board').querySelector('.intro').textContent=admin?'Проверьте новые обращения, ответьте автору и отметьте ход исправления.':mine?'Статусы и ответы по вашим обращениям.':'Проверьте, не сообщал ли о вашей ошибке кто-то ещё, или оставьте новую заявку.';
  $('board').querySelector('h1').textContent=admin?'Модерация заявок':mine?'Мои заявки':'Ошибки и исправления';
  $('board-note').textContent=admin?'Новые заявки видны только вам и автору. Откройте заявку, проверьте описание, задайте статус и ответ. Публикация добавит описание в общий список; контакт и вложения останутся закрытыми.':mine?'Здесь видны заявки, отправленные из этого браузера после добавления раздела «Мои заявки». Они сохраняются сразу, до проверки модератором. В другом браузере или после удаления cookies список будет пустым.':'Здесь видны только проверенные заявки. Отправленные вами заявки доступны в разделе «Мои заявки».';
  try {
    const result = await api(`/api/${admin?'admin/':mine?'my-':''}reports?${params}`);
    if (version !== generation) return;
    currentItems = result.items;
    $('count').textContent = `${admin?'Все заявки':mine?'Мои заявки':'Опубликовано'}: ${result.total}`;
    $('page').textContent = result.total > 25 ? `Страница ${page}` : '';
    $('prev').hidden = page <= 1;
    $('next').hidden = page * 25 >= result.total;
    $('rows').innerHTML = result.items.length ? result.items.map(item => `<button class="report-row" data-id="${item.id}"><span class="number">#${item.id}</span><span><span class="row-title">${escape(item.title)}</span><span class="row-meta">${statusBadge(item)}<span>${escape(item.area)}</span>${item.version?`<span>${escape(item.version)}</span>`:''}${admin&&!item.published?'<span class="admin-marker">Не опубликована</span>':''}</span></span><span class="row-date">${date(item.updated)}</span></button>`).join('') : `<div class="empty"><h2>${$('search').value||status?'Ничего не найдено':'Здесь появятся заявки'}</h2><p>${$('search').value||status?'Попробуйте другой запрос или статус.':mine?'Отправьте заявку, и она сразу появится здесь.':'После проверки мы публикуем описание проблемы и отмечаем ход исправления.'}</p><a href="/new">Сообщить об ошибке ↗</a></div>`;
    for (const button of $('rows').querySelectorAll('[data-id]')) button.addEventListener('click', () => admin ? edit(currentItems.find(item => item.id === Number(button.dataset.id))) : location.assign((mine?'/mine/':'/r/') + button.dataset.id));
  } catch (error) {
    if (version !== generation) return;
    $('rows').textContent = '';
    $('count').textContent = 'Заявки не загрузились';
    $('global-error').textContent = error.message;
  }
}
function details(item) {
  return `<p class="number">Заявка #${item.id} · ${date(item.created)}</p><h2 class="detail-title">${escape(item.title)}</h2><div class="row-meta">${statusBadge(item)}<span>${escape(item.area)}</span><span>${escape(item.version)}</span></div>${[['Как повторить',item.steps],['Что ожидали',item.expected],['Что получилось',item.actual],['Ответ команды',item.answer]].filter(([,text])=>text).map(([title,text])=>`<section class="detail-section"><h3>${title}</h3><div class="body-text">${escape(text)}</div></section>`).join('')}`;
}
function edit(item) {
  $('editor-content').innerHTML = details(item) + `<section class="detail-section"><h3>Только для команды</h3><p class="body-text">${escape(item.contact || 'Контакт не указан')}</p><div class="attachments">${item.attachments.map(id=>`<a href="/api/admin/attachments/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer"><img src="/api/admin/attachments/${encodeURIComponent(id)}" alt="Скриншот к заявке #${item.id}" loading="lazy"></a>`).join('')}</div><form id="edit-form"><label>Статус<select name="status">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${key===item.status?'selected':''}>${label}</option>`).join('')}</select></label><label>Ответ команды<textarea name="answer" rows="4" maxlength="6000">${escape(item.answer)}</textarea></label><label class="check-label"><input type="checkbox" name="published" ${item.published?'checked':''}>Опубликовать описание заявки</label><p class="private-note">Перед публикацией проверьте описание на пароли и данные клиентов. Контакт и скриншоты остаются закрытыми.</p><p id="edit-error" class="error" role="alert"></p><button class="button">Сохранить</button></form></section>`;
  $('editor').showModal();
  $('edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/admin/reports/' + item.id, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:form.elements.status.value,answer:form.elements.answer.value,published:form.elements.published.checked})});
      $('editor').close(); await load();
    } catch (error) { $('edit-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
$('pending-only').addEventListener('change',()=>{page=1;load();});
$('close-editor').addEventListener('click', () => $('editor').close());
for (const button of document.querySelectorAll('[data-status]')) button.addEventListener('click', () => {
  status = button.dataset.status; page = 1;
  for (const other of document.querySelectorAll('[data-status]')) other.classList.toggle('selected', other === button);
  load();
});
let searchTimer;
$('search').addEventListener('input', () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {page=1;load();},250);});
$('prev').addEventListener('click',()=>{page--;load();});
$('next').addEventListener('click',()=>{page++;load();});
$('files').addEventListener('change', () => {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = []; $('previews').replaceChildren(); $('form-error').textContent = '';
  const files = [...$('files').files];
  if (files.length > 3 || files.some(file => file.size > 3*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))) {
    $('form-error').textContent = 'Выберите до трёх изображений PNG, JPEG или WebP, каждое до 3 МБ.'; $('files').value=''; return;
  }
  for (const file of files) {const image=document.createElement('img');image.alt=file.name;image.src=URL.createObjectURL(file);previewUrls.push(image.src);$('previews').append(image);}
});
async function refreshCaptcha() {
  const form=$('report-form'), button=$('captcha-refresh');
  form.elements.captcha_token.value=''; form.elements.captcha_answer.value='';
  $('captcha-error').textContent=''; button.disabled=true;
  try {
    const challenge=await api('/api/captcha');
    $('captcha-image').src=challenge.image;
    form.elements.captcha_token.value=challenge.token;
  } catch(error) {$('captcha-image').removeAttribute('src');$('captcha-error').textContent=error.message;}
  finally {button.disabled=false;}
}
$('captcha-refresh').addEventListener('click',refreshCaptcha);
$('report-form').addEventListener('submit', async event => {
  event.preventDefault(); const form=event.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;$('form-error').textContent='';
  try {
    if (!form.elements.captcha_token.value) throw new Error('Загрузите картинку проверки и введите код.');
    const result=await api('/api/reports',{method:'POST',body:new FormData(form)});
    if (!Number.isInteger(result.id)) throw new Error('Сервер не подтвердил создание заявки. Проверьте «Мои заявки» перед повторной отправкой.');
    $('receipt-number').textContent='Номер вашей заявки: #'+result.id;
    $('receipt-link').href='/mine/'+result.id;
    show('receipt');window.scrollTo({top:0});
  }
  catch(error){$('form-error').textContent=error.message;await refreshCaptcha();}
  finally{button.disabled=false;}
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('login-error').textContent='';
  try {
    const result=await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    if(result.requires2FA){$('credentials').hidden=true;$('otp').hidden=false;form.elements.email.required=false;form.elements.password.required=false;form.elements.password.value='';form.elements.code.required=true;form.elements.code.focus();return;}
    form.reset();admin=true;$('logout').hidden=false;$('team-link').textContent=result.email;show('board');await load();
  }catch(error){$('login-error').textContent=error.message;}
  finally{button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});location.assign('/');}catch(error){$('global-error').textContent=error.message;}});
(async()=>{
  const path=location.pathname;
  if(path==='/new'){show('new-report');await refreshCaptcha();return;}
  if(path==='/admin'){
    try{const who=await api('/api/admin/session');admin=true;$('logout').hidden=false;$('team-link').textContent=who.email;show('board');await load();}catch{show('login');}
    return;
  }
  if(/^\/(r|mine)\/\d+$/.test(path)){
    show('detail');try{const item=await api((mine?'/api/my-reports/':'/api/reports/')+path.split('/').pop());$('detail').innerHTML=(mine?'<a class="back" href="/mine">← Мои заявки</a>':'<a class="back" href="/">← Все заявки</a>')+details(item);document.title=item.title+' — STEALTHNET';}catch(error){$('global-error').textContent=error.message;}
    return;
  }
  show('board');await load();
})();

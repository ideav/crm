// Функция для отправки асинхронного запроса по https api с обработкой его результата
function newApi(m,u,b,vars,index){ // Параметры: метод, адрес, действие - ветка switch, параметры, ID целевого элемента
    vars=vars||''; // По умолчанию список параметров пуст
    var json,obj=new XMLHttpRequest(); // Объявляем переменную под JSON и API по HTTPS
    obj.open(m,'/'+db+'/'+u,true); // Открываем асинхронное соединение заданным методом по нужному адресу
    if(m=='POST') // Если это POST запрос, то передаем заданные параметры
        if(typeof vars=='object')
            vars.append('_xsrf',xsrf);
        else{
            obj.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
            vars='_xsrf='+xsrf+'&'+vars; // добавляем токен xsrf, необходимый для POST-запроса
        }
    obj.onload=function(e){ // Когда запрос вернет результат - сработает эта функция
        try{ // в this.responseText лежит ответ от сервера
            json=JSON.parse(this.responseText); // Пытаемся разобрать ответ как JSON
        }
        catch(e){ // Если произошла ошибка при разборе JSON
            changeMsg('alert-danger', this.responseText); // Выводим ошибку
        }
        obj.abort(); // Закрываем соединение
        if(typeof window[b]==='function') // Вызываем функцию-исполнитель переданного действия (callback)
            window[b](json,index);
    };
    obj.send(vars); // отправили запрос и теперь будем ждать ответ, а пока - выходим
}

var state = false;
var navbar = document.getElementById("navbarSupportedContent");
var rightBlock = document.getElementById("right_block");

var navListItem = document.getElementById('navlist') ? document.getElementById('navlist').innerHTML : '';
var navList = document.getElementById('dropdown-list') ? document.getElementById('dropdown-list').innerHTML : '';
var extraListItem = document.getElementById('dropdown-list') ? document.getElementById('dropdown-list').innerHTML : '';
var extraListTemplate = document.getElementById('extralist') ? document.getElementById('extralist').innerHTML : '';

function resizeMutations(){
    var extraList='',listLength=byId('brand').offsetWidth; // The nav's length in pixels
    byId('navbar-list').innerHTML='';
    for(var i in menu){ // Add a menu item and calc the space left for the rest of items
        if(listLength+byId('right_block').offsetWidth+200<document.documentElement.clientWidth
                || (i==menu.length-1 && extraList==='') // Do not shrink the lone last item
                || document.documentElement.clientWidth<=562){
            byId('navbar-list').innerHTML+=navListItem.replace(/:href:/g,menu[i].href)
                                                    .replace(':name:',menu[i].name)
                                                    .replace(':id:',i);

            listLength+=byId('list'+i).offsetWidth; // Update the total space occupied
        }
        else // No space left - fill in the Extra dropdown menu
            extraList+=extraListItem.replace(/:href:/g,menu[i].href)
                                    .replace(':name:',menu[i].name);
    }
    if(extraList!=='') // Put the extra menu in, if any
        byId('navbar-list').innerHTML+=extraListTemplate.replace(extraListItem,extraList);
    document.querySelectorAll('a[href$="'+document.location.pathname+'"]').forEach(function(el){
        el.classList.add('nav-link-active');
    });
    if(document.querySelectorAll('.nav-link-active').length===0&&action==='object')
        document.querySelectorAll('a[href$="dict"]').forEach(function(el){ el.classList.add('nav-link-active'); });
    if(action.length>0)
        document.querySelectorAll('a[href*="'+action+'?"]').forEach(function(el){ el.classList.add('nav-link-active'); });
}
// Put the burger's menu after the nav pane to see the proper dropdown list
var observer = new MutationObserver((e) => {
    e.forEach(mutation => {
        if (mutation.target.classList.contains('show')) {
                navbar.parentNode.insertBefore(rightBlock, navbar)
        } else {
            rightBlock.parentNode.insertBefore(navbar, rightBlock);
        }
    })
});
if(navbar){
    observer.observe(navbar, { // No idea what this hell is about
        attributes: true
    });
    window.addEventListener('load',function(){
        resizeMutations();
    });
    window.onresize = resizeMutations;
}
var burgerClick = function(target) {
    var collapsable = target.attributes.getNamedItem('data-target');
    var collapseElem = document.getElementById(collapsable.value.replace('#', ''));
    if (collapseElem.classList.contains('show')) {
        collapseElem.classList.remove('show')
    } else {
        collapseElem.classList.add('show')
    }
    //resizeMutations();
}

// Создать DOM-элемент из HTML-строки
function htmlToElement(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.firstChild;
}

// Fill in the GJS repeating groups
document.querySelectorAll('div[src-split]').forEach(function(el){
    if(el.innerHTML.match(/({ *.+ *})/))
        el.setAttribute('src-data', el.innerHTML.match(/({ *.+ *})/)[1]);
    else
        el.removeAttribute('src-split');
});
document.querySelectorAll('[src-report]').forEach(function(el){
    if(el.getAttribute('src-report')>0)
        newApi('GET','report/'+el.getAttribute('src-report')+'?JSON','gjsParseReport','',el);
});
function gjsParseReport(json,el){
    var i,j,html='';
    if(el.tagName==='SELECT'){
        for(i in json.data[0])
            html+='<option value="'+json.data[0][i]+'">'+json.data[1][i]+'</option>';
        el.insertAdjacentHTML('beforeend', html);
    }
    else{
        var tmpClass=getTmpClass();
        el.classList.add(tmpClass);
        var template=el.outerHTML;
        for(i in json.data[0]){
            html=template;
            for(j in json.columns)
                html=html.replace(new RegExp('\{ *'+json.columns[j].name+' *\}','gmi'),json.data[j][i]);
            var newEl=htmlToElement(html);
            newEl.setAttribute('gjs-order',i);
            if(i>0){
                var prev=document.querySelector('.'+tmpClass+'[gjs-order="'+(i-1)+'"]');
                if(prev) prev.parentNode.insertBefore(newEl, prev.nextSibling);
            }
            else
                el.parentNode.replaceChild(newEl, el);
        }
        gjsSeekSplit(tmpClass);
    }
}
document.querySelectorAll('[src-object]').forEach(function(el){
    if(el.getAttribute('src-object')>0)
        newApi('GET','object/'+el.getAttribute('src-object')+'?JSON','gjsParseObject','',el);
});
function gjsParseObject(json,el){
    var i,j,html='';
    if(el.tagName==='SELECT'){
        for(i in json.object)
            html+='<option value="'+json.object[i].id+'">'+json.object[i].val+'</option>';
        el.insertAdjacentHTML('beforeend', html);
    }
    else{
        var tmpClass=getTmpClass();
        el.classList.add(tmpClass);
        var template=el.outerHTML;
        for(i in json.object){
            html=template.replace(new RegExp('\{ *'+json.type.val+' *\}','gmi'),json.object[i].val);
            for(j in json.req_type)
                html=html.replace(new RegExp('\{ *'+json.req_type[j]+' *\}','gmi'),getObjReq(json,json.object[i].id,json.req_type[j]));
            var newEl=htmlToElement(html);
            newEl.setAttribute('gjs-order',i);
            if(i>0){
                var prev=document.querySelector('.'+tmpClass+'[gjs-order="'+(i-1)+'"]');
                if(prev) prev.parentNode.insertBefore(newEl, prev.nextSibling);
            }
            else
                el.parentNode.replaceChild(newEl, el);
        }
        gjsSeekSplit(tmpClass);
    }
}
function gjsSeekSplit(tmpClass){
    document.querySelectorAll('.'+tmpClass+' [src-split]').forEach(function(el){
        if(el.getAttribute('src-data').indexOf(el.getAttribute('src-split'))>0)
            gjsSplit(el);
    });
}
function gjsSplit(el) {
    var i,tmpClass=getTmpClass()
        ,html,src=el.getAttribute('src-data')
        ,items=el.getAttribute('src-data').split(el.getAttribute('src-split'));
    el.removeAttribute('src-data');
    el.removeAttribute('src-split');
    el.classList.add(tmpClass);
    var template=el.outerHTML;
    for(i in items){
        html=template.replace(src,items[i]);
        var newEl=htmlToElement(html);
        newEl.setAttribute('gjs-order',i);
        if(i>0){
            var prev=document.querySelector('.'+tmpClass+'[gjs-order="'+(i-1)+'"]');
            if(prev) prev.parentNode.insertBefore(newEl, prev.nextSibling);
        }
        else
            el.parentNode.replaceChild(newEl, el);
    }
}
function postForm(url) {
	const form = document.createElement('form');
	form.method = 'post';
	form.action = '/'+db+'/'+url;
	const xsrfInput = document.createElement('input');
	xsrfInput.type = 'hidden';
	xsrfInput.name = '_xsrf';
	xsrfInput.value = xsrf;
	form.appendChild(xsrfInput);
	document.body.appendChild(form);
    form.submit();
}
function getObjReq(json,i,j){
    var k;
    if(json.reqs&&json.reqs[i])
        for(k in json.req_type)
            if(json.req_type[k]===j)
                return json.reqs[i][k]||'';
    return '';
}
function getTmpClass(){
    return Math.random(100000000).toString(32).substr(-6);
}
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
}
var brandEl = document.getElementById('brand');
if(brandEl) brandEl.innerHTML = '<svg width="40" height="34" viewBox="0 0 40 34" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="34" fill="white" fill-opacity="0.01"></rect><g clip-path="url(#clip0_2328_26459)"><path d="M21.0983 12.4256L19.5194 14.1254L22.2153 17.0289L13.4346 26.3889L2.28812 22.7817V11.2779L13.4346 7.67068L15.452 9.87038L17.0454 8.19038L14.1005 5L0 9.56361V24.4959L14.1005 29.0595L25.3877 17.0289L21.0983 12.4256Z" fill="white"></path><path d="M15.4718 21.634L17.0489 19.9341L14.3548 17.0307L23.1356 7.67068L34.2802 11.2779V22.7817L23.1356 26.3889L21.1127 24.1838L19.5193 25.8656L22.4679 29.0595L36.5683 24.4977V9.56361L22.4679 5L11.1807 17.0307L15.4718 21.634Z" fill="white"></path></g><defs><clipPath id="clip0_2328_26459"><rect width="36.6316" height="24" fill="white" transform="translate(0 5)"></rect></clipPath></defs></svg>';

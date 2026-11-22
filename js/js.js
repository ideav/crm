function byId(i){
    return document.getElementById(i);
}
function getCookie(name){
    var matches=document.cookie.match(new RegExp("(?:^|; )"+name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g,'\\$1')+"=([^;]*)"));
    return matches?decodeURIComponent(matches[1]):undefined;
}
function t9n(text){
    var l=text.indexOf(locale);
    if(l==-1)
        return text;
    l = l + locale.length;
    var n = text.substring(l).search(/\[[A-Z]{2}\]/);
    if(n==-1)
        return text.substring(l);
    return text.substring(l,n+l);
}
// Fetch the locale from cookie
function replacer(match,a,b,c,d){
    return t9n(d);
}
function localize(){
    document.title=t9n(document.title);
    // Translate the content of the t9n class
    $('.t9n').each(function(index){
        // Get inner HTML of all tags with t9n, capture <t9n> tags, and process those with t9n()
        this.innerHTML=this.innerHTML.replace(/((&lt;t9n&gt;)|(<t9n>))(.*?)((&lt;\/t9n&gt;)|(<\/t9n>))/gm, replacer);
        $(this).removeClass('t9n'); // remove the t9n class to show this element
    });
    // Translate the content of the t9n tags
    $('t9n').each(function(index){
        $(this).replaceWith(t9n($(this).html()));
    });
}
function post(a){
	byId('post').action+=a;
	byId('post').submit();
	event.preventDefault?event.preventDefault():(event.returnValue=false);
}
var search=window.location.search.substr(1).split('&').reduce(function(result,item){
    var parts=item.split('=');
    result[parts[0]]=parts[1];
    return result;
}, {});

//var locale=getCookie((db||'my')+'_locale') || navigator.language || navigator.userLanguage;
var locale=getCookie((db||'my')+'_locale') || 'RU';
if(search.locale){
    locale=search.locale;
    document.cookie=(db||'my')+'_locale='+(locale.toUpperCase()=='EN'?'EN':'RU');
}
if(locale.toUpperCase().indexOf('EN')===-1)
    locale='[RU]'; // Use RU by default
else
    locale='[EN]';  // The locale was found

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
    $('#warn').html('').addClass('hidden'); // Очищаем окно предупреждения от прежних результатов
    obj.onload=function(e){ // Когда запрос вернет результат - сработает эта функция
        try{ // в this.responseText лежит ответ от сервера
            json=JSON.parse(this.responseText); // Пытаемся разобрать ответ как JSON
        }
        catch(e){ // Если произошла ошибка при разборе JSON
            $('#warn').html(this.responseText).removeClass('hidden'); // Выводим ошибку
        }
        obj.abort(); // Закрываем соединение
        if(typeof window[b]==='function') // Вызываем функцию-исполнитель переданного действия (callback)
            window[b](json,index);
    };
    obj.send(vars); // отправили запрос и теперь будем ждать ответ, а пока - выходим
}
function autoLayout(str){
    let replacer={'q':'й','w':'ц','e':'у','r':'к','t':'е','y':'н','u':'г','i':'ш','o':'щ','p':'з','[':'х',']':'ъ','a':'ф','s':'ы', 'd':'в','f':'а'
            ,'g':'п','h':'р','j':'о','k':'л','l':'д',';':'ж','\'':'э','z':'я','x':'ч','c':'с','v':'м','b':'и','n':'т','m':'ь',',':'б','.':'ю','/':'.'};
    return str.replace(/[A-z/,.;\'\]\[]/g, function(x){
        return x===x.toLowerCase()?replacer[x]:replacer[x.toLowerCase()].toUpperCase();
    });
}
var bt={'3':'SHORT','8':'CHARS','9':'DATE','13':'NUMBER','14':'SIGNED','11':'BOOLEAN','12':'MEMO','4':'DATETIME'
        ,'10':'FILE','2':'HTML','7':'BUTTON','6':'PWD','5':'GRANT','15':'CALCULATABLE','16':'REPORT_COLUMN','17':'PATH'};
function decodeMeta(json){
    var i,meta={};
    meta.typ=json.id;
    meta.typ_name=json.val;
    meta.reqs={};
    for(i in json.reqs){
        meta.reqs[json.reqs[i].id]={
            type:json.reqs[i].val,
            order:i,
            value:'',
            type:json.reqs[i].val,
            arr:0,
            base:bt[json.reqs[i].type]
        };
        if(json.reqs[i].ref_id){
            meta.reqs[json.reqs[i].id].ref_type=json.reqs[i].ref_id;
            meta.reqs[json.reqs[i].id].ref=json.reqs[i].ref;
            meta.reqs[json.reqs[i].id].attrs=json.reqs[i].attrs;
        }
    }
    return meta;
}
function validateEmail(email){
    return (email||'').match(/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
}
function iGetTemplate(path,rep,name,fd){
    if($('head script[src="/js/jszip.min.js"]').length===0){
        var ele = document.createElement('script');
        ele.setAttribute("type", "text/javascript");
        ele.setAttribute("src", '/js/jszip.min.js');
        $('head').append(ele);
        ele.setAttribute("src", '/js/FileSaver.min.js');
        $('head').append(ele);
    }
    fetch(path)
         .then(response => response.blob())
         .then(content => {newApi('POST','report/'+rep+'?JSON_KV','iGetTemplateDone',fd||'',{path:path,name:name,content:content});})
       .catch(error => { console.error('Error:', error); });
}
function iGetTemplateDone(json,vars) {
    var reader = new FileReader();
    reader.onload = function (e) {
        var i,j,data = new Uint8Array(e.target.result)  // из word
            ,zip = new JSZip();
        zip.loadAsync(data)
            .then(function(zip){
                // в архиве найти файл word/document.xml
                zip.file("word/document.xml").async("string").then(function(xmlfile){
                    //console.log(xmlfile);
                    let newxml=isprXML(xmlfile);
                    for(i in json)
                        for(j in json[i])
                            newxml = newxml.replaceAll('{'+j+(i>0?i:'')+'}',json[i][j]);
                    for(j in json[0])
                        newxml = newxml.replace(new RegExp('\\{'+j+'\\d*?\\}','gmu'),'');
                    zip.file("word/document.xml", newxml);
			        var promise = null;
                    if(JSZip.support.uint8array)
                        promise = zip.generateAsync({ type: "uint8array" });
                    //zip2.file(my_json.File+'.docx', promise);
                    zip.generateAsync({ type: "blob" })
					.then(function (blob) {
						saveAs(blob, vars.name||'out.docx');
					});
                });
            });
    };
    reader.readAsArrayBuffer(vars.content);       
}
function isprXML(xmlfile) {
    // почистить шаблон до правильного вида переменных 
    var re = new RegExp('({'+'.*?})','sg');
    var re2 = /(<.*?>)/g;
    let result = xmlfile.match(re) || [];
    let newres = [];
    result.forEach(element => {
                var newel = element.replace(re2, "");
                xmlfile = xmlfile.replace(element, newel);
            });
     return xmlfile;
}
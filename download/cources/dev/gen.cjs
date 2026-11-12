// Генератор мок-контента: node gen.cjs
const fs=require('fs'),c=require('crypto'),path=require('path');
const h=(l,i,k)=>c.createHash('sha256').update(l+':'+i+':'+k).digest('hex');
const w=(f,o)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,1)+'\n');};
const T=['Доступ','Прогресс','Комментарий','Профиль','Заявка','Промокод','Оплата','Курс автора','Урок автора','Каталог','Файл публикации'];
w('schema.json',{tables:Object.fromEntries(T.map((t,i)=>[t,{id:100+i,req:{}}])),roles:{},reports:{}});
const quiz=(l)=>({kind:'quiz',pass:0.7,questions:[
 {q:'Что такое таблица в Интеграме?',options:[{k:'а',text:'Тип записей'},{k:'б',text:'Картинка'}],hash:h(l,0,'а'),explain:'Таблица описывает тип записей и их реквизиты.'},
 {q:'Сколько будет 2+2?',options:[{k:'а',text:'3'},{k:'б',text:'4'}],hash:h(l,1,'б'),explain:'Арифметика: 4.'}]});
const L=(id,course,n,title,tasks,prev,next,extra='')=>({id,course,n,title,html:'<p>Текст урока «'+title+'». Внешняя ссылка: <a href="https://example.com/x">example.com</a>.</p>'+extra+'<p>'+'Длинный абзац для прокрутки. '.repeat(40)+'</p>',tasks,attachments:[],prev,next});
const m='content/mini/';
w(m+'00-start.json',L('00-start','mini',1,'Старт: знакомство',[{kind:'text',prompt:'<p>Напишите, чему хотите научиться.</p>',template:''}],null,'01-tables'));
w(m+'01-tables.json',L('01-tables','mini',2,'Таблицы и реквизиты',[quiz('01-tables')],'00-start','02-final'));
w(m+'02-final.json',L('02-final','mini',3,'Итоги мини-курса',[{kind:'selfcheck',items:['Я понял, что такое таблица','Я знаю, где искать помощь']}],'01-tables',null));

const a='content/adept-devkey/';
w(a+'p1-planner.json',L('p1-planner','adept',1,'Планировщик задач',[{kind:'file',prompt:'<p>Приложите файл.</p>',accept:'.xlsx',max:5},{kind:'practicum',spec:'p1'}],null,null));
w(a+'curator/p1-planner.json',{criteria:'<ul><li>Есть таблица Задачи</li></ul>',answers:[]});
w('content/checks/p1.json',{id:'p1',title:'Планировщик',checks:[{id:'t',title:'Таблица Задачи существует',hint:'Создайте таблицу Задачи',type:'tableExists',params:{}}]});
const les=(id,n,t,task)=>({id,n,title:t,task});
w('content/courses.json',{version:'dev',courses:[
 {code:'mini',title:'Мини-курс',free:true,path:'mini',lessons:[les('00-start',1,'Старт: знакомство','text'),les('01-tables',2,'Таблицы и реквизиты','quiz'),les('02-final',3,'Итоги мини-курса','selfcheck')]},
 {code:'adept',title:'Адепт',free:false,price:9900,lessons:[les('p1-planner',1,'Планировщик задач','practicum')]},
 {code:'partner',title:'Партнёр',free:false,price:19900,lessons:[les('x1',1,'Закрытый урок','text')]}]});

// #93: опубликованный авторский курс a900 (как его собирает публикация в SPA: манифест + lesson.json по url).
const au='content/authored/', U='/download/cources/dev/'+au;
const aq={kind:'quiz',pass:0.5,questions:[{q:'Где хранить заказы?',options:[{k:'а',text:'В одной таблице «Заказы»'},{k:'б',text:'В пяти файлах'}],hash:h('l1',0,'а'),explain:'Одна таблица — один источник правды.'}]};
w(au+'a900-l1.json',{id:'l1',course:'a900',n:1,title:'Заказы и клиенты',html:'<p>Заказы ведём в одной таблице. <a href="https://example.com/doc" target="_blank" rel="noopener">Пример</a>.</p>',tasks:[aq],attachments:[],prev:null,next:'l2'});
w(au+'a900-l2.json',{id:'l2',course:'a900',n:2,title:'Сроки и ёмкости',html:'<p>Срок готовности — реквизит заказа.</p>',tasks:[{kind:'selfcheck',items:['Я завёл реквизит «Срок»']}],attachments:[],prev:'l1',next:null});
w(au+'a900-manifest.json',{code:'a900',title:'Учёт заказов пекарни',author:'Мария Петрова',lessons:[{id:'l1',n:1,title:'Заказы и клиенты',task:'quiz',url:U+'a900-l1.json'},{id:'l2',n:2,title:'Сроки и ёмкости',task:'selfcheck',url:U+'a900-l2.json'}]});

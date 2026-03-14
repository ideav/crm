var state = false;
var navbar = document.getElementById("navbarSupportedContent");
var rightBlock = document.getElementById("right_block");

var navListItem=$('#navlist').html()
    ,navList=$('#dropdown-list').html()
    ,extraListItem=$('#dropdown-list').html()
    ,extraListTemplate=$('#extralist').html();
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
    $('a[href$="'+document.location.pathname+'"]').addClass('nav-link-active');
    if($('.nav-link-active').length===0&&action==='object')
        $('a[href$="dict"]').addClass('nav-link-active');
	if(action.length>0)
		$('a[href*="'+action+'?"]').addClass('nav-link-active');
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

// Fill in the GJS repeating groups
$('div[src-split]').each(function(){
    if($(this).html().match(/({ *.+ *})/))
        $(this).attr('src-data',$(this).html().match(/({ *.+ *})/)[1]);
    else
        $(this).removeAttr('src-split');
});
$('[src-report]').each(function(){
    if($(this).attr('src-report')>0)
        newApi('GET','report/'+$(this).attr('src-report')+'?JSON','gjsParseReport','',this);
});
function gjsParseReport(json,el){
    var i,j,html='';
    if(el.tagName==='SELECT'){
        for(i in json.data[0])
            html+='<option value="'+json.data[0][i]+'">'+json.data[1][i]+'</option>';
        $(el).append(html);
    }
    else{
        var tmpClass=getTmpClass();
        var template=$(el).addClass(tmpClass).prop('outerHTML');
        for(i in json.data[0]){
            html=template;
            for(j in json.columns)
                html=html.replace(new RegExp('\{ *'+json.columns[j].name+' *\}','gmi'),json.data[j][i]);
            if(i>0)
                $('.'+tmpClass+'[gjs-order='+(i-1)+']').after($(html).attr('gjs-order',i));
            else
                $(el).replaceWith($(html).attr('gjs-order',i));
        }
        gjsSeekSplit(tmpClass);
    }
}
$('[src-object]').each(function(){
    if($(this).attr('src-object')>0)
        newApi('GET','object/'+$(this).attr('src-object')+'?JSON','gjsParseObject','',this);
});
function gjsParseObject(json,el){
    var i,j,html='';
    if(el.tagName==='SELECT'){
        for(i in json.object)
            html+='<option value="'+json.object[i].id+'">'+json.object[i].val+'</option>';
        $(el).append(html);
    }
    else{
        var tmpClass=getTmpClass();
        var template=$(el).addClass(tmpClass).prop('outerHTML');
        for(i in json.object){
            html=template.replace(new RegExp('\{ *'+json.type.val+' *\}','gmi'),json.object[i].val);
            for(j in json.req_type)
                html=html.replace(new RegExp('\{ *'+json.req_type[j]+' *\}','gmi'),getObjReq(json,json.object[i].id,json.req_type[j]));
            if(i>0)
                $('.'+tmpClass+'[gjs-order='+(i-1)+']').after($(html).attr('gjs-order',i));
            else
                $(el).replaceWith($(html).attr('gjs-order',i));
        }
        gjsSeekSplit(tmpClass);
    }
}
function gjsSeekSplit(tmpClass){
    $('.'+tmpClass).find('[src-split]').each(function(){
        if($(this).attr('src-data').indexOf($(this).attr('src-split'))>0)
            gjsSplit(this);
    });
}
function gjsSplit(el){
    var i,tmpClass=getTmpClass()
        ,html,src=$(el).attr('src-data')
        ,items=$(el).attr('src-data').split($(el).attr('src-split'));
    $(el).removeAttr('src-data').removeAttr('src-split');
    var template=$(el).addClass(tmpClass).prop('outerHTML');
    for(i in items){
        html=template.replace(src,items[i]);
        if(i>0)
            $('.'+tmpClass+'[gjs-order='+(i-1)+']').after($(html).attr('gjs-order',i));
        else
            $(el).replaceWith($(html).attr('gjs-order',i));
    }
}
function postForm(url){
	const form = document.createElement('form');
	form.method = 'post';
	form.action = '/'+db+'/'+url;
	const xsrfInput = document.createElement('input');
	xsrfInput.type = 'hidden';
	xsrfInput.name = '_xsrf';
	xsrfInput.value = xsrf;
	form.appendChild(xsrfInput);
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
$('#brand').html('<svg width="40" height="34" viewBox="0 0 40 34" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="34" fill="white" fill-opacity="0.01"></rect><g clip-path="url(#clip0_2328_26459)"><path d="M21.0983 12.4256L19.5194 14.1254L22.2153 17.0289L13.4346 26.3889L2.28812 22.7817V11.2779L13.4346 7.67068L15.452 9.87038L17.0454 8.19038L14.1005 5L0 9.56361V24.4959L14.1005 29.0595L25.3877 17.0289L21.0983 12.4256Z" fill="white"></path><path d="M15.4718 21.634L17.0489 19.9341L14.3548 17.0307L23.1356 7.67068L34.2802 11.2779V22.7817L23.1356 26.3889L21.1127 24.1838L19.5193 25.8656L22.4679 29.0595L36.5683 24.4977V9.56361L22.4679 5L11.1807 17.0307L15.4718 21.634Z" fill="white"></path></g><defs><clipPath id="clip0_2328_26459"><rect width="36.6316" height="24" fill="white" transform="translate(0 5)"></rect></clipPath></defs></svg>');

// Literal text highlighting preserves code, links, copy controls and original markup.
export function clearHighlights(root){for(const mark of root.querySelectorAll('mark[data-docs-match]')){const parent=mark.parentNode;mark.replaceWith(document.createTextNode(mark.textContent));parent.normalize();}}
export function highlightMatches(root,query){
 clearHighlights(root);const term=query.trim();if(!term)return [];
 const special='^$.*+?()[]{}|'+String.fromCharCode(92),escaped=[...term].map(c=>special.includes(c)?String.fromCharCode(92)+c:c).join(''),pattern=new RegExp(escaped,'iu');
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.parentElement?.closest('button,script,style,[hidden],mark')?NodeFilter.FILTER_REJECT:pattern.test(node.textContent)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}}),nodes=[];
 while(walker.nextNode())nodes.push(walker.currentNode);
 const matches=[];for(const node of nodes){if(matches.length>=2000)break;const text=node.textContent,fragment=document.createDocumentFragment();let offset=0;for(const match of text.matchAll(new RegExp(escaped,'giu'))){if(matches.length>=2000)break;fragment.append(document.createTextNode(text.slice(offset,match.index)));const mark=document.createElement('mark');mark.dataset.docsMatch='';mark.textContent=match[0];matches.push(mark);fragment.append(mark);offset=match.index+match[0].length;}fragment.append(document.createTextNode(text.slice(offset)));node.replaceWith(fragment);}return matches;
}

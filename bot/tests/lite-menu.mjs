import assert from 'node:assert/strict';
import { mainMenu } from '../dist/keyboard.js';
const options = {showTrial:true,showVpn:true,showProxy:true,showSingbox:true,showGift:true,showExtraOptions:true,showTickets:true,hasSupportLinks:true,appUrl:'https://example.invalid',groupCabinet:true};
for (const menuMode of ['classic','web']) {
 const menu=mainMenu({...options,menuMode,liteMode:true});
 const buttons=menu.inline_keyboard.flat();
 assert(buttons.some(b=>b.callback_data==='menu:tariffs'||b.web_app?.url.includes('/tariffs')));
 assert(buttons.some(b=>b.callback_data==='menu:my_subs'||b.web_app?.url.includes('/dashboard')));
 assert(!buttons.some(b=>/referral|roulette|gift|extra_options|singbox|promocode|tg_proxy/.test(b.callback_data||b.web_app?.url||'')));
}
const full=mainMenu({...options,groupCabinet:false,liteMode:false});
assert(full.inline_keyboard.flat().some(b=>b.callback_data==='menu:referral'));
console.log('PASS: Lite menus retain purchases and subscriptions with grouping enabled; full mode retains other sections');

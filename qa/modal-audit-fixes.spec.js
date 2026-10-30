/* global window, document */
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {RoomManager} from '../server/gameLogic.js';
import {captureScreenshot} from './visual-capture/screenshot.mjs';

async function fixture(page) {
  const source=await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js',import.meta.url),'utf8');
  await page.route('**/qa/audit-fix-fixture.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:source}));
  await page.goto('/');
  await page.evaluate(async()=>{
    const {state}=await import('/clientState.js');
    state.players=[{id:'p1',serverId:'visual-host',name:'HOST',cash:1450,pos:5,color:'#d74438',textColor:'#d74438'},{id:'p2',serverId:'visual-guest',name:'GUEST',cash:1200,pos:0,color:'#286ea1',textColor:'#286ea1'}];
    state.roomCode='FIXES';document.querySelector('#view-home').classList.add('is-hidden');document.querySelector('#view-game').classList.remove('is-hidden');
  });
  await page.addScriptTag({url:'/qa/audit-fix-fixture.js',type:'module'});
  await page.evaluate(()=>window.__installIpadModalCapture());
}

async function shot(page,testInfo,id,label,selector){
  if(!process.env.POORUP_VISUAL_CAPTURE_DIR)return;
  await captureScreenshot(page,testInfo,{group:'fixes',surfaceId:id,label});
  const {mkdir}=await import('node:fs/promises'),path=await import('node:path');
  const file=path.join(process.env.POORUP_VISUAL_CAPTURE_DIR,testInfo.project.name,'fixes',id+'.detail.png');
  await mkdir(path.dirname(file),{recursive:true});await page.locator(selector).screenshot({path:file,animations:'disabled'});
}

async function noPageOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);}

test('F01 field preview and server proposal agree for above-deed-price rent shares',async({page},testInfo)=>{
  const manager=new RoomManager();
  const room=manager.createRoom({socketId:'fix-host',clientId:'fix-host-client',nickname:'HOST',rulesProfile:'advanced',playerFinance:true});
  room.addOrReconnectPlayer({socketId:'fix-guest',clientId:'fix-guest-client',nickname:'GUEST'});room.startGame();
  const game=room.game,borrower=game.players[1],deed=game.getTile(3);deed.ownerId=borrower.id;borrower.properties.push(3);
  const requests=[];
  await page.exposeFunction('__fixProposal',payload=>{
    requests.push(payload);
    return game.proposePlayerContract('fix-host',{...payload,toPlayerId:borrower.id});
  });
  await fixture(page);
  await page.evaluate(()=>{
    const f=window.__ipadModalCapture;
    f.trade.configureTradeUi({emitServer:(event,payload,ack)=>window.__fixProposal(payload).then(ack),createRequestId:()=> 'preview-proof'});
    f.trade.openFinancingModal('equity',3);
  });
  await page.locator('#finance-amount').fill('150.9');
  await expect(page.locator('#finance-amount')).toHaveValue('150');
  await expect(page.locator('#financing-preview .financing-metrics').filter({hasText:'CONTRIBUTION'})).toContainText('$150');
  await expect(page.locator('#financing-send')).toBeEnabled();
  await shot(page,testInfo,'equity-amount','Equity field and preview agree on $150','#financing-card');
  await page.locator('#financing-send').click();
  await expect.poll(()=>game.pendingPlayerContract?.amount).toBe(150);
  expect(requests).toHaveLength(1);expect(requests[0].amount).toBe(150);expect(deed.price).toBe(60);
  expect(game.players.map(p=>p.cash)).toEqual([1500,1500]);
  await expect(page.locator('#financing-modal')).toBeHidden();
});

test('F02 composer send stays visible and dropdowns remain usable',async({page},testInfo)=>{
  await fixture(page);
  for(const mode of ['equity','loan']){
    await page.evaluate(mode=>window.__ipadModalCapture.trade.openFinancingModal(mode,3),mode);
    const send=page.locator('#financing-send'),box=await send.boundingBox(),viewport=page.viewportSize();
    expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height-4);expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(send).toBeInViewport();
    await page.locator('#finance-recipient-trigger').click();
    const menu=page.locator('#finance-recipient-menu');await expect(menu).toBeVisible();
    await page.keyboard.press('End');await expect(menu.locator('[data-dropdown-value-option]').last()).toBeInViewport();
    await page.keyboard.press('Enter');await expect(page.locator('#finance-recipient-trigger')).toBeFocused();
    await page.locator('#finance-amount').fill('9999');await expect(send).toBeDisabled();
    await expect(page.locator('#finance-amount')).toHaveAttribute('aria-invalid','true');
    await expect(page.locator('#finance-amount-error')).toContainText('Enter an amount you can fund.');
    await page.locator('#finance-amount').fill('150');await expect(send).toBeEnabled();
    await expect(page.locator('#finance-amount')).toHaveAttribute('aria-invalid','false');
    if(mode==='equity'){
      await expect(page.locator('#finance-equity-control-trigger')).toHaveCount(0);
      await expect(page.locator('#finance-equity-permanent')).toHaveCount(0);
      await expect(page.locator('[data-financing-mode=hybrid]')).toHaveCount(0);
      await expect(page.locator('#finance-equity-duration')).toHaveValue('3');
      await expect(page.locator('#financing-mode-tabs [role=tab][data-financing-mode=equity]')).toContainText('PASSIVE');
      await expect(page.locator('#financing-preview .financing-metrics')).not.toContainText('CONTROL');
      await page.evaluate(()=>{const f=window.__ipadModalCapture;for(const tile of f.board.TILES.filter(t=>t.kind==='property'))f.state.owners[tile.i]='p2';f.trade.openFinancingModal('equity',3);});
      await page.locator('#finance-property-trigger').click();
      const propertyMenu=page.locator('#finance-property-menu');await expect(propertyMenu).toBeVisible();
      await page.keyboard.press('End');await expect(propertyMenu.locator('[data-dropdown-value-option]').last()).toBeInViewport();
      await page.keyboard.press('Enter');await expect(page.locator('#finance-property-trigger')).toBeFocused();
      await shot(page,testInfo,'composer-footer','Visible Send Contract with internal terms scrolling','#financing-card');
    }
    await noPageOverflow(page);await page.evaluate(()=>window.__ipadModalCapture.trade.closeFinancingModal());
  }
});

test('F03 full table Social restores network columns and keeps live request and player focus',async({page},testInfo)=>{
  await fixture(page);
  await page.evaluate(()=>{
    const f=window.__ipadModalCapture,s=f.state;
    s.account={account:{id:'fix-account',username:'host',displayName:'HOST'}};s.socialTab='requests';s.socialLoading=false;
    s.social={friends:[],requests:[{id:'friend-1',from:{id:'friend-account',username:'friend',displayName:'A FRIEND'}}],outgoing:[],invites:[],recentPlayers:[],notifications:[]};
    f.social.renderSocialSurface('#social-card');f.surfaces.openSurface('#social-modal','#social-close');
  });
  await expect(page.locator('#social-card .social-hero')).toBeVisible();
  await expect(page.locator('#social-card .social-hero-stats')).toBeVisible();
  await expect(page.locator('#social-card .social-network-rail')).toBeVisible();
  await expect(page.locator('#social-card .social-context')).toBeVisible();
  await expect(page.locator('#social-card .social-table-header, #social-card .social-table-roster')).toHaveCount(0);
  const sizes=await page.locator('#social-card').evaluate(card=>({feed:card.querySelector('.social-surface-body').clientHeight,columns:['.social-network-rail','.social-feed','.social-context'].map(selector=>card.querySelector(selector).getBoundingClientRect().toJSON())}));
  expect(sizes.feed).toBeGreaterThanOrEqual(180);
  expect(sizes.columns[0].right).toBeLessThan(sizes.columns[1].left);
  expect(sizes.columns[1].right).toBeLessThan(sizes.columns[2].left);
  expect(Math.abs(sizes.columns[0].top-sizes.columns[1].top)).toBeLessThanOrEqual(1);
  expect(Math.abs(sizes.columns[1].top-sizes.columns[2].top)).toBeLessThanOrEqual(1);
  const accept=page.locator('#social-card [data-social-request=accept]');
  await accept.focus();await expect(accept).toBeInViewport();
  await page.evaluate(()=>window.__ipadModalCapture.social.renderSocialSurface('#social-card'));
  await expect(accept).toBeFocused();
  const roster=page.locator('#social-card .social-context-roster');
  await expect(roster.locator('[data-social-player]').first()).toBeInViewport();
  await roster.locator('[data-social-player]').first().focus();
  const focusedPlayer=await roster.locator('[data-social-player]').first().getAttribute('data-social-player');
  await page.evaluate(()=>window.__ipadModalCapture.social.renderSocialSurface('#social-card'));
  await expect(roster.locator(`[data-social-player="${focusedPlayer}"]`)).toBeFocused();
  await shot(page,testInfo,'social-context','Full Social hero, vertical network, request feed and nearby players','#social-card');
  await noPageOverflow(page);
});

test('full table Social gates private account features and keeps sign-in reachable for guests',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.state.account=null;f.state.socialTab='requests';f.state.social={requests:[{id:'private-request',from:{id:'private-person',displayName:'PRIVATE FRIEND'}}]};f.social.renderSocialSurface('#social-card');f.surfaces.openSurface('#social-modal','#social-close');});
  await expect(page.locator('#social-card [data-social-guest-content]')).toHaveJSProperty('inert',true);
  const signIn=page.locator('#social-card [data-social-guest-gate] [data-social-action=account]');
  await expect(signIn).toBeVisible();await signIn.focus();await expect(signIn).toBeFocused();await expect(signIn).toBeInViewport();
  await expect(page.locator('#social-card')).not.toContainText('PRIVATE FRIEND');
  await expect(page.locator('#social-card [data-friendship-id=private-request]')).toHaveCount(0);
  await expect(page.locator('#social-card .social-hero')).toBeVisible();
  await expect(page.locator('#social-card .social-context')).toBeVisible();
  await noPageOverflow(page);
});

test('due-card layout is restored while rescue and confirmation still preserve debt',async({page},testInfo)=>{
  await fixture(page);
  await page.evaluate(()=>{
    const f=window.__ipadModalCapture;
    f.state.players[0].cash=40;f.state.pendingDebt={amount:275,playerId:'visual-host',creditorId:'visual-guest'};
    window.__fixRecovery={holdings:0,emits:0};
    f.game.configureGameModals({openHoldings:()=>window.__fixRecovery.holdings++,emitServer:()=>window.__fixRecovery.emits++});
    f.game.openBankruptcyModal(0,275,'p2','Rent due');
  });
  await expect(page.locator('#bank-liquidate')).toBeFocused();
  await expect(page.locator('#bank-liquidate')).toHaveClass(/btn-dark/);
  await expect(page.locator('#bank-declare')).toHaveClass(/cta-red/);
  await expect(page.locator('#bankruptcy-card .bank-rescue-heading')).toHaveCount(0);
  await shot(page,testInfo,'debt-recovery','Restored due-card layout with unchanged safeguards','#bankruptcy-card');
  await page.locator('#bank-liquidate').click();
  expect(await page.evaluate(()=>window.__fixRecovery.holdings)).toBe(1);
  expect(await page.evaluate(()=>window.__ipadModalCapture.state.pendingDebt.amount)).toBe(275);
  await page.evaluate(()=>window.__ipadModalCapture.game.openBankruptcyModal(0,275,'p2','Rent due'));
  await page.locator('#bank-declare').click();
  await expect(page.locator('#bank-declare-confirm')).toBeVisible();await expect(page.locator('#bank-declare-cancel')).toBeFocused();
  expect(await page.evaluate(()=>window.__fixRecovery.emits)).toBe(0);
  await page.locator('#bank-declare-cancel').click();
  expect(await page.evaluate(()=>window.__ipadModalCapture.state.pendingDebt.amount)).toBe(275);
});

test('F05 reference prison glyph fits without making corners interactive',async({page},testInfo)=>{
  await fixture(page);
  expect(await page.evaluate(async()=>{
    const f=window.__ipadModalCapture;
    const {tileSupportsInspection}=await import('/clientTileInteraction.js');return tileSupportsInspection(f.board.STANDARD_TILES[30]);
  })).toBe(false);
  await page.evaluate(()=>window.__ipadModalCapture.popup.openPopup(window.__ipadModalCapture.board.STANDARD_TILES[30]));
  await expect(page.locator('.pop-prison-mark')).toBeVisible();
  const icon=await page.locator('.pop-prison-mark').boundingBox();expect(icon.width).toBeLessThanOrEqual(60);
  await shot(page,testInfo,'prison-reference','Contained prison bars in the reference inspector','#popup-card');
});

test('F06 direct metric picker retains scope cache and keyboard navigation',async({page},testInfo)=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const f=window.__ipadModalCapture,s=f.state;
    window.__fixRankingRequests=[];
    const emit=(event,payload,ack)=>{window.__fixRankingRequests.push({event,payload});if(event==='get-leaderboard-snapshot')ack({success:true,metrics:{...s.leaderboard.snapshots,[payload.metric]:[]},scope:payload.scope});};
    f.social.configureSocialSurfaces({emitServer:emit});(await import('/clientParlorBindings.js')).bindParlorSurfaces({emitServer:emit});
    s.leaderboard.scope='month';s.leaderboard.metric='wins';s.leaderboard.snapshots.wins=[{accountId:'cached',value:2}];
    f.social.renderRankingsSurface('#rankings-card');f.surfaces.openSurface('#rankings-modal','#rankings-close');
  });
  const picker=page.locator('#rankings-card [data-ranking-metric]');await expect(picker.locator('option')).toHaveCount(15);
  const next=await picker.locator('option').nth(2).getAttribute('value');await picker.selectOption(next);
  await expect(picker).toHaveValue(next);await expect(picker).toBeFocused();
  const state=await page.evaluate(()=>({metric:window.__ipadModalCapture.state.leaderboard.metric,scope:window.__ipadModalCapture.state.leaderboard.scope,cache:window.__ipadModalCapture.state.leaderboard.snapshots.wins,requests:window.__fixRankingRequests}));
  expect(state.metric).toBe(next);expect(state.scope).toBe('month');expect(state.cache[0].accountId).toBe('cached');
  expect(state.requests.filter(r=>r.event==='get-leaderboard-snapshot')).toHaveLength(1);
  await shot(page,testInfo,'ranking-picker','Direct metric selection with arrows retained','#rankings-card');await noPageOverflow(page);
});

test('F07 short flight lists stay compact with a reachable booking action',async({page},testInfo)=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const f=window.__ipadModalCapture;f.flight=await import('/clientFlightUi.js');
    f.state.serverTiles=f.board.STANDARD_TILES.map(t=>({...t,index:t.i}));
    f.state.flights={enabled:true,defaultFare:100,maxFee:200,options:[{tileIndex:15,fare:100,basis:'default',payeeId:null,affordable:true},{tileIndex:25,fare:120,basis:'arrival',payeeId:'visual-guest',affordable:true}]};f.flight.openFlightDesk();
  });
  const card=await page.locator('#flight-card').boundingBox();expect(card.height).toBeLessThan(440);
  await expect(page.locator('#flight-go')).toBeInViewport();expect((await page.locator('#flight-go').boundingBox()).height).toBeGreaterThanOrEqual(56);
  await page.locator('[data-flight-tile="25"]').click();await expect(page.locator('[data-flight-tile="25"]')).toBeFocused();
  await expect(page.locator('#flight-go')).toContainText('$120');
  await shot(page,testInfo,'flight-compact','Content-sized flight desk with selected fare','#flight-card');await noPageOverflow(page);
});

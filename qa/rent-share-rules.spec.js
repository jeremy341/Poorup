/* global window, document */
import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {RoomManager} from '../server/gameLogic.js';
import {captureScreenshot} from './visual-capture/screenshot.mjs';

async function fixture(page){
  const source=await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js',import.meta.url),'utf8');
  await page.route('**/qa/rent-rules-fixture.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:source}));
  await page.goto('/');
  await page.evaluate(async()=>{const {state}=await import('/clientState.js');state.players=[{id:'p1',serverId:'visual-host',clientId:'visual-host-client',name:'HOST',cash:1450,pos:0,color:'#d74438',textColor:'#d74438'},{id:'p2',serverId:'visual-guest',clientId:'visual-guest-client',name:'GUEST',cash:1200,pos:0,color:'#286ea1',textColor:'#286ea1'}];state.clientId='visual-host-client';state.roomCode='RENTQA';document.querySelector('#view-home').classList.add('is-hidden');document.querySelector('#view-game').classList.remove('is-hidden');});
  await page.addScriptTag({url:'/qa/rent-rules-fixture.js',type:'module'});await page.evaluate(()=>window.__installIpadModalCapture());
}
async function shot(page,info,id,label,selector){
  if(!process.env.POORUP_VISUAL_CAPTURE_DIR)return;
  await captureScreenshot(page,info,{group:'rules',surfaceId:id,label});
  const file=path.join(process.env.POORUP_VISUAL_CAPTURE_DIR,info.project.name,'rules',id+'.detail.png');await mkdir(path.dirname(file),{recursive:true});await page.locator(selector).screenshot({path:file,animations:'disabled'});
}
async function noPageOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);}

test('host can customize every module with either starting preset and preserve choices',async({page},info)=>{
  await page.goto('/');await page.locator('#home-alias').fill('RULESHOST');await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis=private]').click();
  const code=('P'+Math.random().toString(36).slice(2,7)).toUpperCase();await page.locator('#rc-room-code').fill(code);await page.locator('#rc-create-btn').click();await page.locator('#su-start').click();
  const profile=page.locator('[data-setting=rulesProfile]');await expect(profile).toHaveValue('standard');
  await expect(profile).toHaveAccessibleName('Starting Preset');
  const flags=['playerFinance','bankLoans','casino','market','flights','bankAccountUpgrades','globalEvents'];
  for(const key of flags){await expect(page.locator(`[data-setting=${key}]`)).toBeEnabled();await expect(page.locator(`[data-setting=${key}]`)).toHaveAttribute('aria-pressed','false');}
  await shot(page,info,'standard-profile','Standard defaults with every feature available to customize','#right-rail-lobby');
  for(const key of flags){const control=page.locator(`[data-setting=${key}]`);await control.click();await expect(control).toHaveAttribute('aria-pressed','true');}
  for(const key of ['casino','bankAccountUpgrades']){await page.locator(`[data-setting=${key}]`).click();await expect(page.locator(`[data-setting=${key}]`)).toHaveAttribute('aria-pressed','false');}
  await page.locator('[data-setting=marketComplexity]').selectOption('derivatives');
  await page.locator('[data-setting=bankLoanSeverity]').selectOption('fair');
  await profile.selectOption('advanced');await expect(profile).toHaveValue('advanced');
  await shot(page,info,'advanced-profile','Advanced starting point preserves the host custom module choices','#right-rail-lobby');
  await profile.selectOption('standard');await expect(profile).toHaveValue('standard');
  for(const key of flags)await expect(page.locator(`[data-setting=${key}]`)).toHaveAttribute('aria-pressed',['casino','bankAccountUpgrades'].includes(key)?'false':'true');
  await expect(page.locator('[data-setting=marketComplexity]')).toHaveValue('derivatives');
  await expect(page.locator('[data-setting=bankLoanSeverity]')).toHaveValue('fair');
  await shot(page,info,'custom-rules','Custom rules remain active with the Standard starting preset','#right-rail-lobby');
  await noPageOverflow(page);
});

test('finance off refuses new finance surfaces while accepted legacy repayment stays available',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.state.settings.rulesProfile='standard';f.state.settings.playerFinance=false;f.trade.openFinancingModal('equity',3);f.sponsorship.requestSponsorship(5);});
  await expect(page.locator('#financing-modal')).toBeHidden();await expect(page.locator('#sponsorship-modal')).toBeHidden();
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.state.playerContracts={active:[{id:'legacy-loan',kind:'loan',status:'active',fromPlayerId:'visual-guest',toPlayerId:'visual-host',amount:300,totalDue:345,remaining:345,premiumRate:15,dueRound:10,collateralTileIndices:[1]}]};f.trade.openFinancingContract('legacy-loan');});
  await expect(page.locator('#financing-modal')).toBeVisible();await expect(page.locator('[data-financing-repay]')).toBeVisible();
  await expect(page.locator('#financing-card')).toContainText('$345');await noPageOverflow(page);
});

test('new rent-share composer emits finite passive terms and previews the agreed amount',async({page},info)=>{
  const manager=new RoomManager(),room=manager.createRoom({socketId:'ui-investor',clientId:'ui-investor',nickname:'Investor',rulesProfile:'standard',playerFinance:true});
  room.addOrReconnectPlayer({socketId:'ui-owner',clientId:'ui-owner',nickname:'Owner'});room.startGame();
  const game=room.game,owner=game.players[1],deed=game.getTile(3);deed.ownerId=owner.id;owner.properties.push(3);
  const sent=[];
  await page.exposeFunction('__rentProposal',payload=>{sent.push(payload);return game.proposePlayerContract('ui-investor',{...payload,toPlayerId:owner.id});});
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.state.settings.rulesProfile='standard';f.state.settings.playerFinance=true;f.trade.configureTradeUi({emitServer:(event,payload,ack)=>window.__rentProposal(payload).then(ack),createRequestId:()=> 'ui-rent-offer'});f.trade.openFinancingModal('equity',3);});
  await expect(page.locator('#financing-card')).toContainText('RENT SHARE');await expect(page.locator('#finance-equity-control-trigger')).toHaveCount(0);await expect(page.locator('#finance-equity-permanent')).toHaveCount(0);
  await page.locator('#finance-amount').fill('217');await expect(page.locator('#financing-preview')).toContainText('$217');
  await expect(page.locator('#finance-equity-duration')).toHaveValue('3');
  await expect(page.locator('#financing-preview')).toContainText(/no capital refund|no capital repayment/i);
  await expect(page.locator('#financing-preview')).toContainText(/collected rent/i);
  expect((await page.locator('#financing-preview').innerText()).split(/\s+/).length).toBeLessThan(55);
  await expect(page.locator('#financing-preview .financing-metrics')).not.toContainText('CONTROL');
  await expect(page.locator('#financing-send')).toBeInViewport();
  await shot(page,info,'rent-share-composer','Temporary passive rent share with clear term and consequences','#financing-card');
  await page.locator('#financing-send').click();await expect.poll(()=>game.pendingPlayerContract?.amount).toBe(217);
  expect(sent).toHaveLength(1);expect(game.pendingPlayerContract.rentShareVersion).toBe(1);expect(game.pendingPlayerContract.durationRounds).toBe(3);expect(game.pendingPlayerContract.permanent).toBe(false);expect(game.pendingPlayerContract.equityControl).toBe('passive');
  const result=game.respondPlayerContract('ui-owner',true,'accept',game.pendingPlayerContract.id);expect(result.success).toBe(true);
  expect(result.contract.expiresRound).toBe(game.roundNumber+3);expect(deed.ownerId).toBe(owner.id);
});

test('funding creates the same finite rent-share product and keeps side-by-side choices',async({page},info)=>{
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture;window.__fundingTerms=[];f.sponsorship.configureSponsorshipUi({emitServer:(event,payload,ack)=>{window.__fundingTerms.push({event,payload});ack({success:false,error:'Fixture keeps request open.'});}});f.sponsorship.requestSponsorship(5);});
  const options=page.locator('#sponsorship-card .sponsorship-mode-options label');await expect(options).toHaveCount(2);
  const bounds=await options.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));expect(Math.abs(bounds[0].top-bounds[1].top)).toBeLessThanOrEqual(1);
  await page.locator('#sponsorship-card input[name=mode][value=equity]').check();await expect(page.locator('#sponsorship-card')).toContainText('RENT SHARE');
  await expect(page.locator('#sponsorship-card input[name=durationRounds]')).toHaveValue('3');await expect(page.locator('#sponsorship-card [data-sponsorship-rent-terms]')).toContainText(/no capital refund/i);
  expect((await page.locator('#sponsorship-card [data-sponsorship-rent-terms]').innerText()).split(/\s+/).length).toBeLessThanOrEqual(15);
  await shot(page,info,'rent-share-funding','Gift or temporary rent-share funding at the restored width','#sponsorship-card');
  await page.locator('#sponsorship-card button[type=submit]').click();
  const sent=await page.evaluate(()=>window.__fundingTerms);expect(sent).toHaveLength(1);expect(sent[0].event).toBe('request-sponsored-purchase');expect(Number(sent[0].payload.durationRounds)).toBe(3);expect(sent[0].payload.mode).toBe('equity');
  await noPageOverflow(page);
});

test('active rent-share and collateral defaults disclose rights and exact residuals',async({page},info)=>{
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.state.playerContracts={active:[{id:'new-share',kind:'equity',rulesVersion:2,rentShareVersion:1,status:'active',fromPlayerId:'visual-guest',toPlayerId:'visual-host',amount:150,propertyIndex:1,equityShare:20,equityControl:'passive',durationRounds:3,expiresRound:8}]};f.trade.openFinancingContract('new-share');});
  await expect(page.locator('#financing-card')).toContainText('RENT SHARE');await expect(page.locator('#financing-card')).toContainText(/start of round 8/i);await expect(page.locator('[data-financing-repay]')).toHaveCount(0);await expect(page.locator('[data-equity-transfer]')).toHaveCount(0);
  expect((await page.locator('.financing-ledger-action').innerText()).split(/\s+/).length).toBeLessThan(25);
  await expect(page.locator('#financing-card')).not.toContainText('No loan repayment.');
  await shot(page,info,'rent-share-active','Amounts, exact expiry and a short risk note','#financing-card');
  await page.evaluate(()=>{const f=window.__ipadModalCapture;f.trade.closeFinancingModal();f.state.playerContracts={active:[{id:'quoted-loan',kind:'loan',rulesVersion:2,status:'active',fromPlayerId:'visual-guest',toPlayerId:'visual-host',amount:300,totalDue:300,remaining:300,premiumRate:0,dueRound:10,collateralTileIndices:[1],collateralCreditVersion:1,collateralCreditQuotes:[{tileIndex:1,name:'SALVADOR',value:60}]}]};f.trade.openFinancingContract('quoted-loan');});
  await expect(page.locator('#financing-card')).toContainText(/no surplus/i);await expect(page.locator('#financing-card')).toContainText('$240');
  await shot(page,info,'collateral-terms','Locked printed-price quote and residual before agreement','#financing-card');await noPageOverflow(page);
});

test('full finance explanations remain on the Rules page',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>window.__ipadModalCapture.social.openRulesSurface('loans'));
  await expect(page.locator('#rules-book-page-heading')).toContainText('Borrow only');
  const body=page.locator('.rules-article-body');
  await expect(body).toContainText('The owner pays construction costs');
  await expect(body).toContainText('New rent shares cannot be resold');
  await expect(body).toContainText('no surplus cash');
  await expect(body).toContainText('without a capital refund');
  await noPageOverflow(page);
});

test('restored table Social matches the supplied structure and keeps requests usable',async({page},info)=>{
  await fixture(page);
  await page.evaluate(()=>{const f=window.__ipadModalCapture,s=f.state;s.account={account:{id:'social-host',username:'host',displayName:'HOST'}};s.socialTab='requests';s.social={friends:[],requests:[{id:'request',from:{id:'friend',username:'friend',displayName:'A FRIEND'}}],outgoing:[],invites:[],notifications:[],recentPlayers:[]};f.social.renderSocialSurface('#social-card');f.surfaces.openSurface('#social-modal','#social-close');});
  await expect(page.locator('#social-card .social-hero')).toBeVisible();await expect(page.locator('#social-card .social-network-rail')).toBeVisible();await expect(page.locator('#social-card .social-context')).toBeVisible();await expect(page.locator('#social-card .social-table-header')).toHaveCount(0);
  await page.locator('#social-card [data-social-request=accept]').focus();await expect(page.locator('#social-card [data-social-request=accept]')).toBeInViewport();
  await shot(page,info,'social-restored','Restored full Social header, navigation, feed and nearby players','#social-card');await noPageOverflow(page);
});

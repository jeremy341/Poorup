/* global window, document, getComputedStyle */
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function installFixture(page) {
  const fixture=await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js',import.meta.url),'utf8');
  await page.route('**/qa/modal-fixes-fixture.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:fixture}));
  await page.goto('/');
  await page.evaluate(async()=>{
    const {state}=await import('/clientState.js');
    state.players=[{id:'p1',serverId:'visual-host',name:'HOST',cash:1450,pos:5,color:'#d74438',textColor:'#d74438'},{id:'p2',serverId:'visual-guest',name:'GUEST',cash:1200,pos:0,color:'#286ea1',textColor:'#286ea1'}];
    state.roomCode='SOLQA';
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
  });
  await page.addScriptTag({url:'/qa/modal-fixes-fixture.js',type:'module'});
  await page.evaluate(()=>window.__installIpadModalCapture());
}

async function openFinancing(page,kind) {
  await page.evaluate(kind=>window.__ipadModalCapture.trade.openFinancingModal(kind,1),kind);
}

async function closeFinancing(page) {
  await page.evaluate(()=>window.__ipadModalCapture.trade.closeFinancingModal());
}

async function seedActiveContract(page,kind) {
  await page.evaluate(kind=>{
    const f=window.__ipadModalCapture;
    f.state.playerContracts={active:[{id:'sol-contract',kind,status:'active',fromPlayerId:'visual-guest',toPlayerId:'visual-host',amount:300,principal:300,totalDue:kind==='equity'?0:345,remaining:kind==='equity'?0:345,premiumRate:15,dueRound:10,cureRound:11,propertyIndex:1,equityShare:20,equityControl:'passive',expiresRound:20,conversionShare:25,collateralTileIndices:[1]}]};
    f.trade.openFinancingContract('sol-contract');
  },kind);
}

async function expectLegacyContractActions(page,kind) {
  const card=page.locator('#financing-card');
  await expect(card).toContainText(kind==='equity'?'INVESTOR':'LENDER');
  await expect(card).toContainText('GUEST');
  if(kind==='equity'){
    await expect(page.locator('[data-financing-repay]')).toHaveCount(0);
    return;
  }
  const repay=page.locator('[data-financing-repay]');
  await expect(repay).toHaveCount(1);
  await expect(card).toContainText('$345');
  await repay.focus();
  await expect(repay).toBeInViewport();
  expect((await repay.boundingBox()).height).toBeGreaterThanOrEqual(44);
}

async function expectCardInViewport(page) {
  const card=await page.locator('#financing-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y+card.height).toBeLessThanOrEqual(page.viewportSize().height+1);
}

async function expectComposerSizing(page) {
  const widths={};
  for(const kind of ['loan','equity']){
    await openFinancing(page,kind);
    widths[kind]=(await page.locator('#financing-card').boundingBox()).width;
    if(kind!=='equity')expect(widths[kind]).toBeLessThanOrEqual(700);
    await closeFinancing(page);
  }
  expect(widths.equity).toBeGreaterThan(widths.loan+50);
  await openFinancing(page,'hybrid');
  await expect(page.locator('#financing-card')).toHaveAttribute('data-financing-mode','loan');
  await expect(page.locator('[data-financing-mode=hybrid], #finance-hybrid-rate, #finance-hybrid-conversion')).toHaveCount(0);
  await closeFinancing(page);
}

test('loan and rent-share composers retain sizing while legacy active contracts retain actions',async({page})=>{
  await installFixture(page);
  await expectComposerSizing(page);
  for(const kind of ['loan','equity','hybrid']){
    await seedActiveContract(page,kind);
    await expectLegacyContractActions(page,kind);
    await expectCardInViewport(page);
    await closeFinancing(page);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
});

async function openOwnedDeed(page,{houses,mortgaged,rent}) {
  await page.evaluate(({houses,mortgaged,rent})=>{
    const f=window.__ipadModalCapture,s=f.state;
    f.deed.closeDeedDetail();
    s.owners={...s.owners,1:'p1',3:'p1'};
    s.houses=houses;
    s.mortgaged=mortgaged;
    s.serverTiles=[{index:1,houseCount:rent.houseCount,currentRent:rent.currentRent}];
    f.deed.openDeedDetail(1);
  },{houses,mortgaged,rent});
}

async function expectSemanticDeedActions(page) {
  await openOwnedDeed(page,{houses:{1:5,3:5},mortgaged:{},rent:{houseCount:5,currentRent:1250}});
  await expect(page.locator('#dd-sell')).toContainText('SELL HOTEL');
  const colors=await page.evaluate(()=>['#dd-mortgage','#dd-sell'].map(q=>getComputedStyle(document.querySelector(q)).color));
  expect(colors[0]).not.toBe(colors[1]);
}

async function expectRentPausedDeed(page) {
  await openOwnedDeed(page,{houses:{},mortgaged:{1:true},rent:{houseCount:0,currentRent:0}});
  await expect(page.locator('#deed-card-detail')).toContainText('RENT PAUSED');
  await expect(page.locator('#dd-mortgage')).toContainText('UNMORTGAGE');
}

async function expectAirportFares(page) {
  await page.evaluate(()=>{
    const f=window.__ipadModalCapture;
    f.deed.closeDeedDetail();
    f.state.flights={enabled:true,defaultFare:130,maxFee:200,options:[]};
    f.state.serverTiles=[{index:5,departureFee:40,arrivalFee:0}];
    f.popup.openPopup(f.board.STANDARD_TILES[5]);
  });
  await expect(page.locator('#popup-card')).toContainText('DEPARTURE $40');
  await expect(page.locator('#popup-card')).toContainText('ARRIVAL $0');
  await expect(page.locator('#popup-card')).toContainText('STANDARD FARE $130');
}

test('deed state has semantic actions and airport inspector shows exact configured zero fees',async({page})=>{
  await installFixture(page);
  await expectSemanticDeedActions(page);
  await expectRentPausedDeed(page);
  await expectAirportFares(page);
});

async function seedFriendRequest(page) {
  await page.evaluate(async()=>{
    const f=window.__ipadModalCapture,s=f.state;
    s.account={account:{id:'sol-account',username:'host',displayName:'HOST'}};
    s.socialTab='requests';s.socialLoading=false;s.socialError='';
    s.social={friends:[],requests:[{id:'sol-friendship',from:{id:'friend-account',username:'friend',displayName:'A FRIEND'}}],outgoing:[],invites:[],notifications:[],recentPlayers:[]};
    window.__solFriendCalls=[];
    const emit=(event,payload,ack)=>{window.__solFriendCalls.push({event,payload,ack});};
    f.social.configureSocialSurfaces({emitServer:emit});
    (await import('/clientParlorBindings.js')).bindParlorSurfaces({emitServer:emit});
    f.social.renderSocialSurface('#social-card');f.surfaces.openSurface('#social-modal','#social-close');
  });
}

function acceptCalls(page) {
  return page.evaluate(()=>window.__solFriendCalls.filter(c=>c.event==='respond-friend-request').length);
}

async function failFirstAcceptWithRetry(page) {
  await page.evaluate(()=>{
    const s=window.__ipadModalCapture.state;s.account={...s.account,account:{...s.account.account,displayName:'REFRESHED'}};
    window.__solFriendCalls.find(c=>c.event==='respond-friend-request').ack({success:false,error:'Please retry.'});
  });
}

test('friend request keyboard retry survives pending render and same-account refresh',async({page})=>{
  await installFixture(page);
  await seedFriendRequest(page);
  const accept=page.locator('#social-card [data-social-request=accept]');
  await accept.focus();await page.keyboard.press('Enter');
  await expect(accept).toBeDisabled();
  await expect(page.locator('#social-card .social-feed')).toBeFocused();
  expect(await acceptCalls(page)).toBe(1);
  await failFirstAcceptWithRetry(page);
  await expect(accept).toBeEnabled();await expect(accept).toBeFocused();
  await page.keyboard.press('Enter');
  await page.evaluate(()=>window.__solFriendCalls.filter(c=>c.event==='respond-friend-request').at(-1).ack({success:true}));
  await expect(page.locator('#social-card [data-friendship-id=sol-friendship]')).toHaveCount(0);
  expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('#social-card')))).toBe(true);
});

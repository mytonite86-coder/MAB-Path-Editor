from datetime import datetime, timezone
from types import SimpleNamespace
import ast, subprocess
from pathlib import Path
import pytest
from bson import ObjectId
from fastapi import HTTPException
import server
from models import CreateSvgSubscriptionCheckoutRequest
from svg_subscription import SVG_PRICE_IDS, SVG_TOOL_CATALOG, SVG_BUNDLE_ID, build_svg_checkout_plan, quote_svg_subscription, SvgSubscriptionSelectionError
from test_svg_commercial_integration import environment, signed_event

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.mark.anyio
@pytest.mark.parametrize('pid', list(SVG_PRICE_IDS))
async def test_one_time_purchase(environment, monkeypatch, pid):
    uid = ObjectId(); protected = ['mab_s1_subscription','founder_lifetime']
    await environment.users.insert_one({'_id':uid,'email':'fixture@example.invalid','username':'fixture','created_at':datetime.now(timezone.utc),'entitlements':protected.copy(),'is_premium':True})
    monkeypatch.setattr(server, "STRIPE_API_KEY", "fixture_key")
    captured = {}
    def create(params):
        captured.update(params)
        return SimpleNamespace(id='cs_lifetime',url='https://checkout.stripe.com/c/pay/cs_lifetime')
    monkeypatch.setattr(server.stripe,'StripeClient',lambda *args:SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=SimpleNamespace(create=create)))))
    await server.create_svg_subscription_checkout_session(CreateSvgSubscriptionCheckoutRequest(selected_product_ids=[pid],origin_url='https://mytonite86-coder.github.io/svg-path-closer/index.html'),None,{'user_id':str(uid),'email':'fixture@example.invalid'})
    assert captured['mode']=='payment'
    assert captured['line_items']==[{'price':SVG_PRICE_IDS[pid],'quantity':1}]
    assert not {'subscription_data','discounts','allow_promotion_codes'} & captured.keys()
    expected=list(SVG_TOOL_CATALOG) if pid==SVG_BUNDLE_ID else [pid]
    session={'id':'cs_lifetime','mode':'payment','status':'complete','payment_status':'paid','amount_total':3499 if pid==SVG_BUNDLE_ID else 999,'currency':'usd','metadata':captured['metadata']}
    event={'id':'evt_lifetime','object':'event','type':'checkout.session.completed','data':{'object':session}}
    assert not await server.process_checkout_session(session)
    with pytest.raises(HTTPException): await signed_event(event,invalid=True)
    assert (await environment.users.find_one({'_id':uid}))['entitlements']==protected
    await signed_event(event); await signed_event(event)
    user=await environment.users.find_one({'_id':uid})
    assert set(user['entitlements'])==set(protected+expected)
    assert len(user['entitlements'])==len(set(user['entitlements']))
    assert set(user['svg_lifetime_entitlements'])==set(expected)
    assert user['is_premium'] is True
    assert server.build_user_response(user).svg_lifetime_entitlements==user['svg_lifetime_entitlements']
    assert await environment.payment_transactions.count_documents({})==1
    for entitlement in expected: await server.revoke_product_entitlement(str(uid),entitlement)
    assert (await environment.users.find_one({'_id':uid}))['entitlements']==user['entitlements']

@pytest.mark.anyio
@pytest.mark.parametrize('failure',['unpaid','incomplete','failed','wrong_owner','wrong_amount','wrong_currency','subscription_mode'])
async def test_denials(environment,failure):
    uid=ObjectId(); await environment.users.insert_one({'_id':uid,'entitlements':[]})
    meta={'package_id':'svg_micro_eco_lifetime','billing_mode':'payment','user_id':str(uid),'selected_product_ids':'curve_repair','purchase_product_ids':'curve_repair'}
    await environment.payment_transactions.insert_one({'session_id':'cs_denial','user_id':str(uid),'package_id':'svg_micro_eco_lifetime','selected_product_ids':['curve_repair'],'metadata':meta,'amount_total':999})
    session={'id':'cs_denial','mode':'payment','status':'complete','payment_status':'paid','amount_total':999,'currency':'usd','metadata':dict(meta)}
    event_type='checkout.session.completed'
    if failure=='unpaid':session['payment_status']='unpaid'
    if failure=='incomplete':session['status']='open'
    if failure=='failed':event_type='checkout.session.async_payment_failed'
    if failure=='wrong_owner':session['metadata']['user_id']=str(ObjectId())
    if failure=='wrong_amount':session['amount_total']=1
    if failure=='wrong_currency':session['currency']='eur'
    if failure=='subscription_mode':session['mode']='subscription'
    await signed_event({'id':'evt_denial','object':'event','type':event_type,'data':{'object':session}})
    assert (await environment.users.find_one({'_id':uid}))['entitlements']==[]

def test_pricing_and_invalid_selection():
    assert quote_svg_subscription(list(SVG_TOOL_CATALOG))['total_cents']==3499
    assert quote_svg_subscription(['pathseal','curve_repair'])['total_cents']==1998
    for ids in [[],['pathseal','pathseal'],['unknown'],[SVG_BUNDLE_ID,'pathseal']]:
        with pytest.raises(SvgSubscriptionSelectionError):build_svg_checkout_plan(ids,{})

def test_mab_unchanged():
    root=Path('../..').resolve()
    source=subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'show','4b0f3f2df51454f2c4ffd54443507668140d092d:Blueprint-Clean/backend/server.py']).decode()
    node=next(n.value for n in ast.parse(source).body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PREMIUM_PACKAGES' for t in n.targets))
    assert server.PREMIUM_PACKAGES['mab_s1_payment']==ast.literal_eval(node)['mab_s1_payment']
    assert 'pathseal_monthly' not in server.PREMIUM_PACKAGES

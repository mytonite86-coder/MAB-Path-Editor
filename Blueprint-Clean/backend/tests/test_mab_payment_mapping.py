"""Block 32: local signed MAB fulfillment and preservation checks only."""
from bson import ObjectId
import pytest
import server
from test_svg_commercial_integration import environment, signed_event

@pytest.fixture
def anyio_backend(): return 'asyncio'

async def fixture(db, product='mab_s1.5'):
    uid=ObjectId()
    await db.users.insert_one({'_id':uid,'entitlements':['curve_repair'],'svg_lifetime_entitlements':['curve_repair'],'is_premium':False})
    await db.payment_transactions.insert_one({'session_id':'cs_mapping','user_id':str(uid),'product_id':product,'package_id':product+'_payment','billing_mode':'payment','processed_upgrade':False})
    obj={'id':'cs_mapping','mode':'payment','status':'complete','payment_status':'paid','amount_total':3000,'currency':'usd','metadata':{'user_id':str(uid),'product_id':product}}
    return uid,obj

async def send(obj, event_type='checkout.session.completed'):
    return await signed_event({'id':'evt_mapping','object':'event','type':event_type,'data':{'object':obj}})

@pytest.mark.anyio
@pytest.mark.parametrize('product',['mab_s1','mab_s1.5'])
@pytest.mark.parametrize('event_type',['checkout.session.completed','checkout.session.async_payment_succeeded'])
async def test_supported_s1_identifiers_grant_once(environment,product,event_type):
    uid,obj=await fixture(environment,product)
    await send(obj,event_type); await send(obj,event_type)
    user=await environment.users.find_one({'_id':uid})
    assert set(user['entitlements'])=={'curve_repair','mab_s1'}
    assert len(user['entitlements'])==2 and user['is_premium'] is True
    assert user['svg_lifetime_entitlements']==['curve_repair']
    assert (await environment.payment_transactions.find_one({'session_id':'cs_mapping'}))['processed_upgrade'] is True
    assert await environment.payment_transactions.count_documents({})==1

@pytest.mark.anyio
@pytest.mark.parametrize('product',['mab_s2','mab_s1.75','unrelated'])
async def test_unissued_identifiers_cannot_grant_s1(environment,product):
    uid,obj=await fixture(environment,product); await send(obj)
    user=await environment.users.find_one({'_id':uid})
    assert user['entitlements']==['curve_repair'] and user['is_premium'] is False

@pytest.mark.anyio
@pytest.mark.parametrize('failure',['unpaid','pending','failed_event','wrong_owner','invalid_signature'])
async def test_unsuccessful_or_wrong_owner_cannot_grant(environment,failure):
    uid,obj=await fixture(environment)
    if failure in ['unpaid','pending']:obj['payment_status']=failure
    if failure=='wrong_owner':obj['metadata']['user_id']=str(ObjectId())
    if failure=='invalid_signature':
        with pytest.raises(Exception):
            await signed_event({'id':'evt_bad','object':'event','type':'checkout.session.completed','data':{'object':obj}},invalid=True)
    else: await send(obj,'checkout.session.async_payment_failed' if failure=='failed_event' else 'checkout.session.completed')
    user=await environment.users.find_one({'_id':uid})
    assert user['entitlements']==['curve_repair'] and user['is_premium'] is False
    assert (await environment.payment_transactions.find_one({'session_id':'cs_mapping'}))['processed_upgrade'] is False

@pytest.mark.anyio
async def test_existing_zero_payment_promotion_contract_is_retained(environment):
    uid,obj=await fixture(environment,'mab_s1');obj['payment_status']='no_payment_required'
    await send(obj)
    assert 'mab_s1' in (await environment.users.find_one({'_id':uid}))['entitlements']

@pytest.mark.anyio
async def test_permanent_s1_survives_legacy_subscription_cancellation(environment):
    uid,obj=await fixture(environment);await send(obj)
    await environment.users.update_one({'_id':uid},{'$addToSet':{'entitlements':'mab_s1_subscription'}})
    await server.revoke_product_entitlement(str(uid),'mab_s1_subscription')
    user=await environment.users.find_one({'_id':uid})
    assert set(user['entitlements'])=={'mab_s1','curve_repair'} and user['is_premium'] is True

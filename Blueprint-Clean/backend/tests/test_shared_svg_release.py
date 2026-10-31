"""Block 31: deployed MAB compatibility and shared Stripe event isolation."""
import ast
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from bson import ObjectId
import server
from models import CreateCheckoutSessionRequest
from test_svg_commercial_integration import environment, signed_event

DEPLOYED='4b0f3f2df51454f2c4ffd54443507668140d092d'
ROOT=Path('../..').resolve()
def deployed(path):
    return subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'show',DEPLOYED+':Blueprint-Clean/backend/'+path]).decode()
def functions(source):
    return {n.name:n for n in ast.parse(source).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}

@pytest.fixture
def anyio_backend(): return 'asyncio'

def test_protected_current_mab_functions_and_modules_unchanged():
    old=functions(deployed('server.py')); new=functions(Path('server.py').read_text())
    names={name for name in old if any(token in name for token in ['shopify','activation','fulfillment','license'])}
    names.update(['configure_stripe','create_checkout_session','build_checkout_return_urls','get_checkout_status','get_user_entitlements','build_access_token_for_user','get_current_user_info'])
    for name in names: assert ast.dump(new[name])==ast.dump(old[name]), name
    for name in ['auth.py','activation_codes.py','shopify_delivery.py','fulfillment_router.py','fulfillment_store.py','subscription_policy.py','requirements.txt','readiness.py']:
        assert Path(name).read_bytes().replace(b'\r\n',b'\n')==deployed(name).encode().replace(b'\r\n',b'\n'), name

def test_mab_payment_mapping_is_explicit_and_s1_only():
    assert server.MAB_PAYMENT_ENTITLEMENTS == {"mab_s1": "mab_s1", "mab_s1.5": "mab_s1"}
    assert "mab_s2" not in server.MAB_PAYMENT_ENTITLEMENTS

@pytest.mark.anyio
async def test_current_mab_payment_configuration(environment,monkeypatch):
    capture={}
    monkeypatch.setattr(server,'STRIPE_API_KEY','fixture_only')
    def create(**params):
        capture.update(params)
        return SimpleNamespace(id='cs_mab_fixture',url='https://checkout.stripe.com/c/pay/cs_mab_fixture')
    monkeypatch.setattr(server.stripe.checkout.Session,'create',create)
    user={'user_id':str(ObjectId()),'email':'mab@example.invalid'}
    await server.create_checkout_session(CreateCheckoutSessionRequest(package_id='mab_s1_payment',origin_url='https://mytonite86-coder.github.io/MAB-Path-Editor'),None,user)
    assert capture['mode']=='payment'
    assert capture['line_items'][0]['price_data']['unit_amount']==3000
    assert capture['metadata']['product_id']=='mab_s1.5'
    assert capture['allow_promotion_codes'] is True
    assert 'payment_method_collection' not in capture
    assert not {'subscription_data','recurring'} & capture.keys()
    assert (await environment.payment_transactions.find_one({'session_id':'cs_mab_fixture'}))['product_id']=='mab_s1.5'

@pytest.mark.anyio
@pytest.mark.parametrize('product',['mab_s1.5','svg_micro_eco_lifetime'])
async def test_verified_shared_webhook_routes_exact_payment_object(environment,monkeypatch,product):
    process=AsyncMock(return_value=True); sync=AsyncMock()
    monkeypatch.setattr(server,'process_checkout_session',process)
    monkeypatch.setattr(server,'sync_product_subscription',sync)
    obj={'id':'cs_dispatch_fixture','object':'checkout.session','metadata':{'product_id':product}}
    await signed_event({'id':'evt_dispatch','object':'event','type':'checkout.session.completed','data':{'object':obj}})
    assert process.await_count==1
    actual=process.await_args.args[0]
    assert server.stripe_dict(actual)['metadata']['product_id']==product
    assert process.await_args.kwargs['event_type']=='checkout.session.completed'
    sync.assert_not_awaited()

@pytest.mark.anyio
async def test_mab_s15_paid_checkout_requires_entitlement(environment):
    uid=ObjectId()
    await environment.users.insert_one({'_id':uid,'entitlements':[],'is_premium':False})
    await environment.payment_transactions.insert_one({'session_id':'cs_current_mab_fixture','user_id':str(uid),'product_id':'mab_s1.5','package_id':'mab_s1.5_payment','billing_mode':'payment','processed_upgrade':False})
    await signed_event({'id':'evt_current_mab_fixture','object':'event','type':'checkout.session.completed','data':{'object':{'id':'cs_current_mab_fixture','mode':'payment','status':'complete','payment_status':'paid','amount_total':3000,'currency':'usd','metadata':{'product_id':'mab_s1.5'}}}})
    user=await environment.users.find_one({'_id':uid})
    assert 'mab_s1' in user['entitlements'] and user['is_premium'] is True

import json
import copy
import struct
import zlib
from datetime import datetime,timedelta,timezone
import pytest
from conftest import weather_payload


def test_route_uses_eta_and_conservative_adjacent_hour(engine):
    departure=datetime.now(timezone.utc).replace(minute=1,second=0,microsecond=0)+timedelta(hours=1)
    data=weather_payload()
    idx=next(i for i,s in enumerate(data['hourly']['time']) if datetime.fromisoformat(s).hour==departure.hour)
    # Hazard emerges at the destination ETA; start still has light gusts.
    data['hourly']['wind_gusts_10m'][idx+2:]=[80.]*(48-idx-2)
    calls=[]
    def fetch(url,*args):
        calls.append(url)
        return json.dumps([data,data,data,data]).encode()
    body={'waypoints':[{'lat':33.5,'lon':-86.8},{'lat':34.,'lon':-86.8}],
          'departure_utc':departure.isoformat(),'duration_minutes':120,'location_ack':True}
    result=engine._cx4_route_exposure(body,fetch)
    assert result['spatial_samples']==4
    assert result['samples'][0]['weather_gate']=='CAUTION'
    assert result['samples'][-1]['weather_gate']=='NO_GO'
    assert result['gate']=='NO_GO'
    assert sum(result['sampled_exposure_minutes'].values())==pytest.approx(120,abs=1e-4)
    assert result['positions_returned_or_persisted'] is False
    assert len(calls)==1
    assert '33.50' in calls[0] and '34.00' in calls[0]


def test_weather_forecast_has_missing_not_zero(engine):
    payload=weather_payload()
    now=datetime.now(timezone.utc).isoformat()
    payload['hourly']['visibility']=[None]*48
    weather=engine._cx4_hour_at(payload,now)
    assert weather['visibility_km'] is None
    gate=engine._cx4_gate(weather,{},now)
    assert gate['weather_gate']=='UNKNOWN'


@pytest.mark.parametrize('bad',[float('nan'),float('inf'),True,-10,700])
def test_invalid_gust_never_clear(engine,bad):
    now=datetime.now(timezone.utc).isoformat()
    gate=engine._cx4_gate({'wind_gust_kph':bad,'precipitation_mm':0.,'visibility_km':10.}, {'activity':0},now)
    assert gate['weather_gate']=='UNKNOWN'


def test_invalid_values_do_not_override_real_no_go(engine):
    now=datetime.now(timezone.utc).isoformat()
    gate=engine._cx4_gate({'wind_gust_kph':float('nan'),'precipitation_mm':5.,'visibility_km':10.},{'activity':0},now)
    assert gate['weather_gate']=='NO_GO'


def test_future_current_weather_rejected(engine):
    now=datetime.now(timezone.utc)
    gate=engine._cx4_gate({'wind_gust_kph':1,'precipitation_mm':0.,'visibility_km':10.,
                           'updated_at':(now+timedelta(hours=5)).isoformat()},{'activity':0},now.isoformat())
    assert gate['weather_gate']=='UNKNOWN'


def test_wrong_units_rejected(engine):
    data=weather_payload()
    data['hourly_units']['wind_gusts_10m']='mph'
    with pytest.raises(ValueError):engine._cx4_hour_at(data,datetime.now(timezone.utc).isoformat())


def test_outside_or_disordered_forecast_not_extrapolated(engine):
    data=weather_payload()
    with pytest.raises(ValueError):engine._cx4_hour_at(data,'2040-11-08T12:00:00Z')
    data['hourly']['time'][5]=data['hourly']['time'][0]
    with pytest.raises(ValueError):engine._cx4_hour_at(data,datetime.now(timezone.utc).isoformat())


def test_route_geometry_dateline_and_duplicates(engine):
    samples,dist=engine._cx4_sample_route([{'lat':0,'lon':179.9},{'lat':0,'lon':-179.9}])
    assert 20<dist<25
    assert all(abs(s['lon'])>179 for s in samples)
    with pytest.raises(ValueError):engine._cx4_sample_route([{'lat':0,'lon':1},{'lat':0,'lon':1}])


def test_weather_current_uses_hourly_accumulation(engine):
    data=weather_payload()
    data['current']['precipitation']=0.2
    data['hourly']['precipitation']=[3.]*48
    now=engine._cx4_current(data)
    assert now['precipitation_mm']==3.
    assert now['precipitation_accumulation_seconds']==3600


def test_consent_and_invalid_waypoints(engine):
    now=datetime.now(timezone.utc).isoformat()
    with pytest.raises(ValueError):engine._cx4_route_exposure({'departure_utc':now,'duration_minutes':60,'location_ack':False})
    with pytest.raises(ValueError):engine._cx4_sample_route([{'lat':True,'lon':1},{'lat':3,'lon':1}])


def make_png(x0=0,x1=256):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    row=b'\x00'+b''.join(bytes((20,80,200,255 if x0<=x<x1 else 0)) for x in range(256))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',256,256,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(row*256))+chunk(b'IEND',b'')


def test_radar_samples_location_not_tile_center(engine):
    # At zoom 7, longitude 0.28 lies close to left edge of its XYZ tile.
    # Opaque band is on left, while center is transparent.
    image=make_png(0,50)
    left=engine._cx4_radar_pixels(image,0.4,0.28)
    center=engine._cx4_radar_pixels(image,0.4,1.4)
    assert left['activity']==1 and center['activity']==0
    assert left['coverage_verified'] is False
    assert left['point_rainfall_mm'] is None


def test_motion_recovers_unambiguous_historical_translation(engine):
    a=[0.]*256;b=[0.]*256
    shape=[(6,6),(6,7),(7,7),(8,7),(9,7),(9,8),(8,9)]
    for x,y in shape:a[y*16+x]=1.;b[y*16+x+1]=1.
    move=engine._cx4_motion(a,b,600)
    assert move['available'] and move['tile_cells_dx']==1 and move['tile_cells_dy']==0
    assert move['nowcast'] is False
    assert not engine._cx4_motion([0.]*256,[0.]*256,600)['available']


def test_radar_right_dateline_edge_not_wrapped_to_tile_left(engine):
    image=make_png(0,50)
    result=engine._cx4_radar_pixels(image,0.4,180.)
    assert result['activity']==0
    assert result['region_clipped_at_tile_edge'] is True

import numpy as np
import pandas as pd
import yfinance as yf

START = "2015-01-01"
END = "2026-09-16"
PERIODS = [1,3,5,10]


def dl(ticker):
    x = yf.download(ticker, start=START, end=END, auto_adjust=True, actions=False, progress=False, threads=False)
    if x.empty:
        raise RuntimeError(f"no data: {ticker}")
    if isinstance(x.columns, pd.MultiIndex):
        x.columns = x.columns.get_level_values(0)
    x.columns = [c.lower() for c in x.columns]
    x.index = pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_c_indicators(df):
    out = df.copy()
    out['month_run_high'] = out.groupby(out.index.to_period('M'))['high'].cummax()
    out['ma60'] = out['close'].rolling(60).mean()
    out['ma60_20ago'] = out['ma60'].shift(20)
    return out


def c_base_position(df):
    pos = 0.0
    anchor = None
    u1=u2=u3=False
    vals=[]
    for _,r in df.iterrows():
        px=float(r['close']); rh=r['month_run_high']
        if pos>0 and anchor is not None and px>=anchor:
            pos=0.0; anchor=None; u1=u2=u3=False
        else:
            if pos==0 and pd.notna(rh) and px<=float(rh)*0.97:
                anchor=float(rh); pos=0.20; u1=True
            if pos>0 and anchor is not None:
                if (not u2) and px<=anchor*0.94:
                    pos+=0.30; u2=True
                if (not u3) and px<=anchor*0.91:
                    pos+=0.50; u3=True
                pos=min(pos,1.0)
        vals.append(pos)
    return pd.Series(vals,index=df.index,dtype=float)


def regime_mult(df):
    vals=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']):
            vals.append(0.5); continue
        a = r['close'] > r['ma60']
        b = r['ma60'] > r['ma60_20ago']
        if a and b: vals.append(3.0)
        elif a or b: vals.append(2.0)
        else: vals.append(0.5)
    return pd.Series(vals,index=df.index,dtype=float)


def strategy_equity(df):
    target = c_base_position(df) * regime_mult(df)
    pos_open = target.shift(1).fillna(0.0)
    fwd = df['open'].shift(-1)/df['open']-1
    ret=(pos_open*fwd).dropna()
    return (1+ret).cumprod(), pos_open.loc[ret.index]


def bh_equity(df):
    c=df['close'].dropna()
    return c/c.iloc[0]


def synthetic_2x_equity(df):
    r=df['close'].pct_change().fillna(0.0)
    # theoretical daily 2x, gross, floored at -100%
    lr=(2.0*r).clip(lower=-0.999999)
    return (1+lr).cumprod()


def metrics(eq):
    eq=eq.dropna()
    total=float(eq.iloc[-1]-1)
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1)
    dd=eq/eq.cummax()-1
    mdd=float(dd.min())
    return total,cagr,mdd,total/abs(mdd) if mdd<0 else np.nan


def pct(x): return f"{x*100:.1f}%"


def main():
    etf=add_c_indicators(dl('0050.TW'))
    taiex=dl('^TWII')
    l2=dl('00631L.TW')
    end=min(etf.index.max(),taiex.index.max(),l2.index.max())
    print('BENCHMARK_V13_BEGIN')
    print('| Period | Asset/Strategy | Total | CAGR | MDD | Return/MDD |')
    print('|---|---|---:|---:|---:|---:|')
    for y in PERIODS:
        st=end-pd.DateOffset(years=y)
        e=etf[(etf.index>=st)&(etf.index<=end)].copy()
        t=taiex[(taiex.index>=st)&(taiex.index<=end)].copy()
        q=l2[(l2.index>=st)&(l2.index<=end)].copy()
        items=[]
        ceq,_=strategy_equity(e)
        items.append(('C MA60 3/2/0.5',ceq))
        items.append(('0050 B&H',bh_equity(e)))
        items.append(('TAIEX B&H (TXF 1x proxy)',bh_equity(t)))
        items.append(('TAIEX synthetic daily 2x',synthetic_2x_equity(t)))
        items.append(('00631L B&H',bh_equity(q)))
        for name,eq in items:
            total,cagr,mdd,rom=metrics(eq)
            print(f"| {y}Y | {name} | {pct(total)} | {pct(cagr)} | {pct(mdd)} | {rom:.2f} |")
    print('BENCHMARK_V13_END')

if __name__=='__main__': main()

# v1.3 benchmark workflow trigger

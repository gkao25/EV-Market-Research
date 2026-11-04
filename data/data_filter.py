import pandas as pd

def data_clean(ev_data, output_file):
    df = pd.read_csv(ev_data)
    cleaned_df = df[['brand', 'market_segment', 'model', 'year', 'price_usd']].copy()

    cleaned_df.to_csv(output_file, index=False)
    return cleaned_df

cleaned_data = data_clean("ev_market_2026.csv", "cleaned_ev_data.csv")
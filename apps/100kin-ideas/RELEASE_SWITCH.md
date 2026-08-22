# 100均アイデア LP 公開切替

切替箇所は `apps/100kin-ideas/index.html` の `<html data-lp-phase="...">` だけ。初期値は `waitlist`。

## 公開手順

1. Worker の `STORE_LINKS_JSON` に実ストアURLを設定して、先にデプロイする
2. `/go/100kin/ios` と `/go/100kin/android` が正しいストアへ 302 することを確認する
3. LP の `data-lp-phase` を `waitlist` から `store` に変更する
4. LP をデプロイする
5. 管理画面で `LP → ストア` の LP表示・iOS・Android が増えることを確認する

## ロールバック

`data-lp-phase` を `waitlist` に戻して LP をデプロイするだけ。

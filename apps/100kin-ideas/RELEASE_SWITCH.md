# 100均アイデア LP 公開切替

切替箇所は `apps/100kin-ideas/index.html` の `<html data-lp-phase="...">` だけ。初期値は `waitlist`。

## 公開手順

1. Worker の `STORE_LINKS_JSON` に実ストアURLを設定して、先にデプロイする
2. 公開前に `/go/100kin/ios` と `/go/100kin/android` が 302 を返し、`Location` が設定したURLと一致することを確認する。この時点ではストアページ自体が404でも問題ない
3. Google Playを公開し、App Store ConnectでiOSを手動リリースする
4. 両ストアページが実際に表示できることを確認する
5. LP の `data-lp-phase` を `waitlist` から `store` に変更する
6. LP をデプロイする
7. 管理画面で `LP → ストア` の LP表示・iOS・Androidが増えることを確認する

LPの切替は、両ストアページの表示確認が取れてから行う。Workerの302だけならストア公開前でも確認できる。

## ロールバック

`data-lp-phase` を `waitlist` に戻して LP をデプロイするだけ。

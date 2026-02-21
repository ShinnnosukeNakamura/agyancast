---
title: "執筆環境: Zenn本のセットアップ"
---

この章は、Zennアカウントを作った直後の方向けに、最短で執筆を始める手順を整理したものです。

## 1. 先に理解しておくこと

Zenn本は「Webエディタに直接書く」より、次の運用が実務的です。

- ローカルでMarkdownを書く
- GitHubにpushする
- Zennが同期して公開する

つまり、Zenn本は「Git管理されるドキュメント」です。

## 2. Node.jsのバージョンを合わせる

2026-02-21 時点で `zenn-cli@0.4.5` は `Node.js >= 22` が必要です。

このリポジトリでは `.nvmrc` を `22` にしています。次を実行します。

```bash
cd /Users/nakamurashinnosuke/Documents/GitHub/agyancast
nvm install 22
nvm use 22
node -v
```

## 3. Zenn CLIを導入する

```bash
cd /Users/nakamurashinnosuke/Documents/GitHub/agyancast
npm init -y
npm install -D zenn-cli@latest
npx zenn init
```

これで `books/` ディレクトリが使える状態になります。

## 4. 本を作る

```bash
npx zenn new:book \
  --slug agyancast-gtfs-rt-data-platform-guide \
  --title "GTFS-RTで作る地域混雑可視化入門" \
  --published false \
  --price 0
```

- `published: false` の間は下書き
- `published: true` で公開対象

## 5. ローカルプレビュー

```bash
npx zenn preview
```

ブラウザで `http://localhost:8000` を開き、見た目を確認しながら書きます。

## 6. 公開フロー

1. ZennとGitHubリポジトリを連携
2. `config.yaml` で `published: true` にする
3. 連携ブランチにpush
4. ZennのDeploy履歴で同期結果を確認

## 公式ドキュメント

- Zenn GitHub連携: [https://zenn.dev/zenn/articles/connect-to-github](https://zenn.dev/zenn/articles/connect-to-github)
- Zenn CLIガイド: [https://zenn.dev/zenn/articles/zenn-cli-guide](https://zenn.dev/zenn/articles/zenn-cli-guide)
- Zenn CLI導入: [https://zenn.dev/zenn/articles/install-zenn-cli](https://zenn.dev/zenn/articles/install-zenn-cli)

この章が終わった時点で、執筆環境は整っています。次章からデータ仕様に入ります。

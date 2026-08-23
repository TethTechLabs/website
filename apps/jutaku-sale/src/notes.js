import { man, yen } from "./calc.js";

export const STAGES = [
  { id: "guess", label: "査定はしていない" },
  { id: "quoted", label: "査定済み" },
];

export const LEVELS = [
  { id: "danger", label: "先に確認すること" },
  { id: "check", label: "確かめること" },
  { id: "know", label: "知っておくこと" },
];

function manCeil(amountYen) {
  const n = Math.ceil(Number(amountYen) / 10_000);
  return `${n.toLocaleString("ja-JP")}万円`;
}

export function sellingNotes({ input, result, ownedYears = 0, flags = {} }) {
  const notes = [];
  const add = (n) => notes.push(n);
  const taxYears = input.heldYears || 0;
  const residence = Boolean(input.isResidence);
  const stage = flags.stage || "guess";

  if (result.net < 0) {
    add({
      id: "over-loan",
      level: "danger",
      title: "自己資金で補わない限り引き渡せません",
      body: `ローン残債が売却代金を${man(result.shortfall)}上回っています。この差額を補って完済しないと抵当権が外れません。${
        flags.breakEven != null ? `${man(flags.breakEven)}以上で売れれば完済できます。` : ""
      }住み替えローンや任意売却という方法もありますので、まず借入先の金融機関にご相談ください。`,
    });
  }

  if (ownedYears > 5 && taxYears <= 5 && result.taxable > 0) {
    const fixed = stage === "contracted";
    add({
      id: "cross-5y",
      level: "danger",
      title: fixed
        ? "引き渡し日が年をまたぐかどうかで税率区分が変わります"
        : "所有期間の区分が短期譲渡になっています",
      body: `所有期間は売った年の1月1日で判定します。いまの時期だと短期（税率39.63%）ですが、${
        fixed
          ? "決済日を年明け以降にできれば長期（20.315%）に変わります。買主の都合もあるため動かせるとは限りません。"
          : "年明け以降の引き渡しにすれば長期（20.315%）に変わります。"
      }税務署または税理士にご確認ください。`,
    });
  }

  if (residence && ownedYears > 10 && taxYears <= 10 && result.taxable > 0) {
    add({
      id: "cross-10y",
      level: "danger",
      title: "所有期間が10年を超えると軽減税率を使えます",
      body: `1月1日基準で10年超が必要です。いまの時期では${taxYears.toFixed(
        1
      )}年の扱いになります。適用されると6,000万円以下の部分は14.21%です。税務署または税理士にご確認ください。`,
    });
  }

  if (result.acquisition.method === "estimated" && result.tax.total > 0) {
    add({
      id: "unknown-cost",
      level: "danger",
      title: "購入時の書類があれば税額が下がる可能性があります",
      body: `いまは取得費を売却価格の5%（${yen(
        result.acquisition.estimated
      )}）で計算しています。売買契約書・通帳の振込記録・ローン契約書などがあれば実額で計算でき、税額が大きく変わることがあります。`,
    });
  }

  if (flags.buyingNext && result.deduction > 0) {
    add({
      id: "deduction-vs-mortgage",
      level: "danger",
      title: "3,000万円控除と住宅ローン控除は併用できません",
      body: "3,000万円控除を使った年の前後2年、計6年間は新居でローン控除を受けられません。売却の税額が小さいなら、控除を使わないほうが得になることもあります。",
    });
  }

  if (residence && !input.useDeduction && result.gross > 0) {
    add({
      id: "deduction-off",
      level: "danger",
      title: "3,000万円特別控除を使わない設定です",
      body: "この試算では特別控除を適用していません。要件を満たすかどうかは、税務署または税理士にご確認ください。",
    });
  }

  if (result.deduction > 0 || result.tax.total > 0 || result.gross < 0) {
    add({
      id: "must-file",
      level: "check",
      title: "税額が0円でも確定申告が必要です",
      body: "3,000万円控除も軽減税率も、確定申告で初めて適用されます。申告しなければ控除前の金額に課税されます。翌年の2月16日〜3月15日に、譲渡所得の内訳書と契約書の写しを提出します。",
    });
  }

  if (result.tax.resident > 0) {
    add({
      id: "resident-tax-timing",
      level: "check",
      title: `住民税${manCeil(result.tax.resident)}は翌年届きます`,
      body: "所得税は確定申告時に納めますが、住民税は翌年6月ごろから届きます。売却代金とは別に取り分けておくと安心です。",
    });
  }

  if (residence) {
    add({
      id: "vacancy-limit",
      level: "check",
      title: "3,000万円控除には期限があります",
      body: "住まなくなった日から3年後の年末までに売却する必要があります。先に引っ越す場合はこの期限にご注意ください。",
    });
  }

  if (flags.inherited) {
    add({
      id: "inherited",
      level: "check",
      title: "相続した家は取得費・所有期間を引き継ぎます",
      body: "亡くなった方の取得時から数えます。相続日からではありません。相続税を納めている場合は取得費加算の特例もあります。税務署または税理士にご確認ください。",
    });
  }

  if (flags.coOwned) {
    add({
      id: "co-owned",
      level: "check",
      title: "共有名義なら控除は持分ごとに使えます",
      body: "夫婦2分の1ずつなら各自3,000万円ずつ控除でき、申告も各自です。このツールは1人ぶんの計算なので、ご自身の持分で入力してください。",
    });
  }

  if (result.gross < 0) {
    add({
      id: "loss-carryover",
      level: "check",
      title: "売却損は給与所得と相殺できる場合があります",
      body: `譲渡所得は${man(
        result.gross
      )}のマイナスです。居住用の売却損は、要件を満たせば給与所得と損益通算し、3年間繰り越せます。税務署または税理士にご確認ください。`,
    });
  }

  add({
    id: "tax-proration",
    level: "check",
    title: "固定資産税の日割り精算金は売却収入です",
    body: "買主から受け取る日割り精算金は、税務上は売買代金の一部です。確定申告で漏れやすいのでご注意ください。",
  });

  if (stage === "quoted") {
    add({
      id: "stage-quoted",
      stageNote: true,
      level: "danger",
      title: "査定額はそのまま売れる金額ではありません",
      body: "媒介契約を取るために相場より高い査定を出す会社があります。根拠にした成約事例を具体的に示せるかどうかで見分けられます。",
    });
  }

  const order = { danger: 0, check: 1, know: 2 };
  return notes.sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      Number(Boolean(b.stageNote)) - Number(Boolean(a.stageNote))
  );
}

export function countByLevel(notes) {
  const out = { danger: 0, check: 0, know: 0 };
  for (const n of notes) out[n.level] += 1;
  return out;
}

"use client";
import { publicErrorMessage } from '@/lib/humanErrors'

import { useCallback, useEffect, useState } from "react";
import { CircleDollarSign, Cpu, ReceiptText } from "lucide-react";
import {
  TableRoot,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/TablePrimitives";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/Dialogs";
import { Select } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { createClientUUID } from "@/lib/uuid";
import type { CaritsAccount, EvaluationCreditOverview } from "@oi-manager/contracts";
import { getOrganizationCaritsTransactions, getPersonalCaritsTransactions } from "@/features/carits";
import { getEvaluationCreditOverview, purchaseEvaluationCreditPackage } from "@/features/evaluation-credits";
import styles from "./WalletPage.module.css";
import {
  canAffordCarits,
  hasPositiveCaritsDebt,
  resourcePurchaseStatusLabel,
  walletTransactionSourceLabel,
  walletTransactionTypeLabel,
} from "./wallet-display";

export function WalletPage({
  scope,
  organizationId,
  embedded = false,
}: {
  scope: "personal" | "organization";
  organizationId?: string;
  embedded?: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<CaritsAccount | null>(null),
    [evaluation, setEvaluation] = useState<EvaluationCreditOverview | null>(null);
  const [walletError, setWalletError] = useState(""),
    [evaluationError, setEvaluationError] = useState(""),
    [loading, setLoading] = useState(true),
    [purchaseOpen, setPurchaseOpen] = useState(false),
    [packageCode, setPackageCode] = useState("EVAL_5K"),
    [purchaseRequestKey, setPurchaseRequestKey] = useState(() => createClientUUID()),
    [buying, setBuying] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setWalletError("");
    setEvaluationError("");
    const [wallet, credits] = await Promise.allSettled([
      scope === "personal"
        ? getPersonalCaritsTransactions()
        : organizationId
          ? getOrganizationCaritsTransactions(organizationId)
          : Promise.reject(new Error("缺少组织上下文")),
      scope === "personal"
        ? getEvaluationCreditOverview()
        : Promise.resolve(null),
    ]);
    if (wallet.status === "fulfilled") setData(wallet.value);
    else {
      setData(null);
      setWalletError(publicErrorMessage(wallet.reason, "钱包信息加载失败"));
    }
    if (credits.status === "fulfilled" && credits.value) setEvaluation(credits.value);
    else if (scope === "personal") {
      setEvaluation(null);
      setEvaluationError(credits.status === "rejected" ? publicErrorMessage(credits.reason, "评测额度加载失败") : "评测额度加载失败");
    }
    setLoading(false);
  }, [organizationId, scope]);
  useEffect(() => {
    void load();
  }, [load]);

  const entries = data?.items || [],
    selected = evaluation?.packages.find(
      (item) => item.packageCode === packageCode,
    );
  const debtOutstanding = hasPositiveCaritsDebt(data?.debtBalance);
  const purchaseBlocker = evaluationError
    ? "评测额度数据未加载"
    : !evaluation
      ? loading
        ? "正在加载评测额度"
        : "评测额度数据未加载"
      : !selected
        ? "当前没有可用的额度套餐"
        : walletError || !data
          ? "钱包余额未加载"
          : debtOutstanding
            ? "存在待偿还 Carits币债务，暂不能兑换"
            : !canAffordCarits(data.availableBalance || data.balance, selected.carits)
              ? "Carits币可用余额不足"
              : "";

  const buy = async () => {
    if (purchaseBlocker) {
      toast.error(purchaseBlocker);
      return;
    }
    setBuying(true);
    try {
      const response = await purchaseEvaluationCreditPackage({ packageCode }, purchaseRequestKey);
      if (!response.ok) return toast.error(response.error.userMessage);
      toast.success("评测额度已到账");
      setPurchaseOpen(false);
      setPurchaseRequestKey(createClientUUID());
      await load();
    } finally {
      setBuying(false);
    }
  };
  const content = (
    <div className={styles.stack}>
      <section className={styles.wallet} aria-label="Carits币钱包">
        <div className={styles.summary}>
          <span className={styles.icon}>
            <CircleDollarSign size={24} aria-hidden="true" />
          </span>
          <div>
            <span className={styles.currency}>Carits币</span>
            <strong>
              {data ? `${data.availableBalance || data.balance || "0"} C` : "—"}
            </strong>
            {hasPositiveCaritsDebt(data?.debtBalance) && (
              <small>待偿还：{data?.debtBalance} C</small>
            )}
          </div>
        </div>
        {walletError ? (
          <div className={styles.errorState} role="alert">
            <p className={styles.error}>{walletError}</p>
            <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
              重新加载
            </Button>
          </div>
        ) : loading && !data ? (
          <p className={styles.empty}>正在加载钱包…</p>
        ) : data?.accountStatus === "empty" ? (
          <p className={styles.empty}>
            暂无资产记录；正式测试数据贡献被采纳后将自动创建账户。
          </p>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>暂无资产变动</p>
        ) : (
          <details>
            <summary>查看资产变动记录</summary>
          <div className={styles.records}>
            <div className={styles.recordsHeader}>
              <ReceiptText size={17} aria-hidden="true" />
              <h2>最近 100 条资产记录</h2>
            </div>
            <div className={styles.tableWrap}>
              <TableRoot>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>时间</TableHeaderCell>
                    <TableHeaderCell>类型</TableHeaderCell>
                    <TableHeaderCell>来源/用途</TableHeaderCell>
                    <TableHeaderCell>变动</TableHeaderCell>
                    <TableHeaderCell>余额</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {new Date(item.createdAt).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell>{walletTransactionTypeLabel(item.type)}</TableCell>
                      <TableCell>{walletTransactionSourceLabel(item.source)}</TableCell>
                      <TableCell>{item.amount}</TableCell>
                      <TableCell>{item.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableRoot>
            </div>
          </div>
          </details>
        )}
      </section>
      {scope === "personal" && (
        <section className={styles.wallet} aria-label="评测额度">
          <div className={styles.creditHeader}>
            <div>
              <span className={styles.icon}>
                <Cpu size={24} aria-hidden="true" />
              </span>
              <div>
                <span className={styles.currency}>评测额度</span>
                <strong>
                  {evaluation
                    ? `剩余 ${(evaluation.free.available + evaluation.purchased.available).toLocaleString()}`
                    : "—"}
                </strong>
                {evaluation ? (
                  <small>
                    今天已用 {evaluation.today.consumed.toLocaleString()} / {evaluation.dailyLimit.toLocaleString()}
                    ；免费额度 {new Date(evaluation.resetsAt).toLocaleDateString("zh-CN")} 恢复
                  </small>
                ) : (
                  <small>{loading ? "正在加载额度…" : "额度数据未加载"}</small>
                )}
              </div>
            </div>
            <div className={styles.creditActions}>
              <Button
                disabled={Boolean(purchaseBlocker)}
                onClick={() => setPurchaseOpen(true)}
              >
                用 Carits 兑换
              </Button>
              {purchaseBlocker && <small className={styles.purchaseBlocker}>{purchaseBlocker}</small>}
            </div>
          </div>
          {evaluationError ? (
            <div className={styles.errorState} role="alert">
              <p className={styles.error}>{evaluationError}</p>
              <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
                重新加载额度
              </Button>
            </div>
          ) : evaluation ? (
            <details>
              <summary>使用详情与兑换记录</summary>
              <div className={styles.creditGrid}>
              <p>
                <span>免费可用 / 总额</span>
                <strong>{evaluation.free.available} / {evaluation.free.limit}</strong>
              </p>
              <p>
                <span>免费已用</span>
                <strong>{evaluation.free.consumed}</strong>
              </p>
              <p>
                <span>免费预占</span>
                <strong>{evaluation.free.reserved}</strong>
              </p>
              <p>
                <span>长期已购</span>
                <strong>{evaluation.purchased.available}</strong>
              </p>
              <p>
                <span>今日已用</span>
                <strong>{evaluation.today.consumed}</strong>
              </p>
              <p>
                <span>当前预占</span>
                <strong>{evaluation.today.reserved}</strong>
              </p>
              </div>
              <p className={styles.resetTime}>
                免费额度和今日使用上限将于 {new Date(evaluation.resetsAt).toLocaleString("zh-CN")} 重置；已购额度长期有效。
              </p>
              <div className={styles.records}>
                <div className={styles.recordsHeader}>
                  <ReceiptText size={17} aria-hidden="true" />
                  <h2>最近兑换</h2>
                </div>
                {evaluation.recentPurchases?.length ? (
                  <div className={styles.tableWrap}>
                    <TableRoot>
                      <TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>套餐</TableHeaderCell><TableHeaderCell>扣除</TableHeaderCell><TableHeaderCell>到账</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell></TableRow></TableHead>
                      <TableBody>{evaluation.recentPurchases.map((item) => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString("zh-CN")}</TableCell><TableCell>{item.packageCode}</TableCell><TableCell>{item.caritsAmount} C</TableCell><TableCell>{item.evaluationCredits.toLocaleString()} 评测额度</TableCell><TableCell>{resourcePurchaseStatusLabel(item.status)}</TableCell></TableRow>)}</TableBody>
                    </TableRoot>
                  </div>
                ) : <p className={styles.empty}>暂无评测额度兑换记录</p>}
              </div>
            </details>
          ) : (
            <p className={styles.empty}>正在加载评测额度…</p>
          )}
        </section>
      )}
      {scope === "organization" && (
        <p className={styles.note}>
          学校贡献归属已记录；学校配套奖励暂未启用。
        </p>
      )}
      <FormDialog
        isOpen={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        onSubmit={buy}
        loading={buying}
        title="兑换评测额度"
        description="购买长期有效，但每日实际使用仍受贡献等级和平台资源硬上限限制。"
        submitText="确认兑换"
        submitDisabled={Boolean(purchaseBlocker)}
      >
        <label className={styles.field}>
          额度套餐
          <Select
            value={packageCode}
            onChange={(event) => {
              setPackageCode(event.target.value);
              setPurchaseRequestKey(createClientUUID());
            }}
          >
            {evaluation?.packages.map((item) => (
              <option value={item.packageCode} key={item.packageCode}>
                {item.carits} C → {item.credits.toLocaleString()} 评测额度
              </option>
            ))}
          </Select>
        </label>
        {selected && (
          <p className={styles.note}>
            将扣除 {selected.carits} Carits币，到账{" "}
            {selected.credits.toLocaleString()}{" "}
            评测额度。价格和额度由服务端固定。
          </p>
        )}
        {purchaseBlocker && <p className={styles.purchaseBlocker} role="alert">{purchaseBlocker}</p>}
      </FormDialog>
    </div>
  );
  if (embedded) return content;
  return (
    <PageFrame width="reading">
      <PageHeader
        title={scope === "personal" ? "我的钱包与评测额度" : "学校资产"}
        description={
          scope === "personal"
            ? "贡献值衡量信誉，Carits币用于兑换长期评测额度。"
            : "查看当前学校的 Carits币资产与消费记录。"
        }
      />
      {content}
    </PageFrame>
  );
}

"use client";

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
import { apiClient } from "@/lib/apiClient";
import { createClientUUID } from "@/lib/uuid";
import styles from "./WalletPage.module.css";
import { hasPositiveCaritsDebt } from "./wallet-display";

interface WalletEntry {
  id: string;
  type: string;
  source: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
}
interface WalletData {
  currency: string;
  accountStatus: "active" | "empty";
  balance?: string;
  availableBalance?: string;
  debtBalance?: string;
  items: WalletEntry[];
}
interface Package {
  packageCode: string;
  carits: string;
  credits: number;
}
interface EvaluationData {
  level: string;
  contributionScore: number;
  dailyLimit: number;
  resetsAt: string;
  free: {
    limit: number;
    available: number;
    reserved: number;
    consumed: number;
  };
  purchased: { available: number; reserved: number; consumed: string };
  today: { reserved: number; consumed: number };
  packages: Package[];
}

export function WalletPage({
  scope,
  endpoint,
  embedded = false,
}: {
  scope: "personal" | "organization";
  endpoint: string;
  embedded?: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<WalletData | null>(null),
    [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
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
    const [wallet, credits] = await Promise.all([
      apiClient.get<WalletData>(endpoint),
      scope === "personal"
        ? apiClient.get<EvaluationData>("/api/resources/evaluation-credits", {
            accountScoped: true,
          })
        : Promise.resolve(null),
    ]);
    if (wallet.success && wallet.data) setData(wallet.data);
    else {
      setData(null);
      setWalletError(wallet.message || "钱包信息加载失败");
    }
    if (credits?.success && credits.data) setEvaluation(credits.data);
    else if (scope === "personal") {
      setEvaluation(null);
      setEvaluationError(credits?.message || "Evaluation Credits 加载失败");
    }
    setLoading(false);
  }, [endpoint, scope]);
  useEffect(() => {
    void load();
  }, [load]);

  const buy = async () => {
    setBuying(true);
    const response = await apiClient.post(
      "/api/resources/evaluation-credits/purchase",
      { packageCode },
      {
        accountScoped: true,
        headers: { "Idempotency-Key": purchaseRequestKey },
      },
    );
    setBuying(false);
    if (!response.success) return toast.error(response.message || "购买失败");
    toast.success("Evaluation Credits 已到账");
    setPurchaseOpen(false);
    setPurchaseRequestKey(createClientUUID());
    await load();
  };
  const entries = data?.items || [],
    selected = evaluation?.packages.find(
      (item) => item.packageCode === packageCode,
    );
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
                      <TableCell>{item.type}</TableCell>
                      <TableCell>{item.source}</TableCell>
                      <TableCell>{item.amount}</TableCell>
                      <TableCell>{item.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableRoot>
            </div>
          </div>
        )}
      </section>
      {scope === "personal" && (
        <section className={styles.wallet} aria-label="Evaluation Credits">
          <div className={styles.creditHeader}>
            <div>
              <span className={styles.icon}>
                <Cpu size={24} aria-hidden="true" />
              </span>
              <div>
                <span className={styles.currency}>Evaluation Credits</span>
                <strong>
                  {evaluation
                    ? evaluation.free.available + evaluation.purchased.available
                    : "—"}
                </strong>
                {evaluation ? (
                  <small>
                    {evaluation.level} · 贡献值 {evaluation.contributionScore} ·
                    今日上限 {evaluation.dailyLimit}
                  </small>
                ) : (
                  <small>{loading ? "正在加载额度…" : "额度数据未加载"}</small>
                )}
              </div>
            </div>
            <Button
              disabled={!evaluation || Boolean(evaluationError)}
              onClick={() => setPurchaseOpen(true)}
            >
              用 Carits 兑换
            </Button>
          </div>
          {evaluationError ? (
            <div className={styles.errorState} role="alert">
              <p className={styles.error}>{evaluationError}</p>
              <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
                重新加载额度
              </Button>
            </div>
          ) : evaluation ? (
            <div className={styles.creditGrid}>
              <p>
                <span>免费可用</span>
                <strong>{evaluation.free.available}</strong>
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
          ) : (
            <p className={styles.empty}>正在加载 Evaluation Credits…</p>
          )}
        </section>
      )}
      {scope === "organization" && (
        <p className={styles.note}>
          组织贡献归因已记录；首版组织匹配奖励暂未启用。
        </p>
      )}
      <FormDialog
        isOpen={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        onSubmit={buy}
        loading={buying}
        title="兑换 Evaluation Credits"
        description="购买长期有效，但每日实际使用仍受贡献等级和平台资源硬上限限制。"
        submitText="确认兑换"
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
                {item.carits} C → {item.credits.toLocaleString()} Credits
              </option>
            ))}
          </Select>
        </label>
        {selected && (
          <p className={styles.note}>
            将扣除 {selected.carits} Carits币，到账{" "}
            {selected.credits.toLocaleString()}{" "}
            Credits。价格和额度由服务端固定。
          </p>
        )}
      </FormDialog>
    </div>
  );
  if (embedded) return content;
  return (
    <PageFrame width="reading">
      <PageHeader
        title={scope === "personal" ? "我的钱包与评估额度" : "校园资产"}
        description={
          scope === "personal"
            ? "贡献值衡量信誉，Carits币用于兑换长期 Evaluation Credits。"
            : "查看当前校园的 Carits币资产与消费记录。"
        }
      />
      {content}
    </PageFrame>
  );
}

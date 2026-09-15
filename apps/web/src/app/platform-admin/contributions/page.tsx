"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/FormControls";
import { DetailDialog, FormDialog } from "@/components/ui/Dialogs";
import { StatusBadge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import {
  TableRoot,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/TablePrimitives";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/features/auth";
import { getPlatformCaritsAudit } from "@/features/carits";
import type { PlatformCarits } from "@oi-manager/contracts";
import {
  candidateSourceLabel,
  contributionSourceLabel,
  contributionStatusPresentation,
  contributionTypeLabel,
  selectionModeLabel,
} from "@/components/contribution/contribution-display";
import styles from "./page.module.css";

type Event = {
  id: string;
  type: string;
  sourceType: string;
  sourceId: string;
  score: number;
  status: string;
  createdAt: string;
  ruleCode?: string;
  ruleVersion?: number;
  evidence?: {
    problemId?: string;
    candidateId?: string;
    promotedRevisionId?: string;
    candidateSource?: string;
    selectionMode?: string;
    rewardCarits?: string;
  } | null;
  Actor: { username: string };
  Attribution?: {
    organizationId: string;
    Organization?: { name: string } | null;
  } | null;
  RewardDelivery?: {
    status: string;
    userCarits: string;
    attemptCount?: number;
    errorMessage?: string | null;
  } | null;
};
type AuditPage = {
  items: Event[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pending: number;
};
type EvidenceDetail = {
  kind: "candidate" | "revision";
  title: string;
  data: unknown | null;
  error: string;
};

type ReviewAction = "accept" | "reject" | "revoke" | "retry";

const rewardStatus: Record<string, string> = {
  pending: "等待结算",
  deferred_budget: "受每日额度限制，已延后",
  posted: "奖励已入账",
  reversing: "奖励冲正中",
  reversed: "奖励已冲正",
  cancelled: "奖励已取消",
  failed: "奖励结算失败",
};

function rewardVariant(value?: string) {
  if (value === "posted") return "success" as const;
  if (value === "failed" || value === "reversed") return "error" as const;
  if (value === "pending" || value === "deferred_budget" || value === "reversing")
    return "warning" as const;
  return "neutral" as const;
}

export default function PlatformContributionPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canDecide = user?.role === "super_admin";
  const [items, setItems] = useState<Event[]>([]),
    [economy, setEconomy] = useState<PlatformCarits | null>(null),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [total, setTotal] = useState(0),
    [totalPages, setTotalPages] = useState(0),
    [pendingCount, setPendingCount] = useState<number | null>(null),
    [selected, setSelected] = useState<Event | null>(null),
    [action, setAction] = useState<ReviewAction | null>(null),
    [evidenceDetail, setEvidenceDetail] = useState<EvidenceDetail | null>(null),
    [evidenceLoading, setEvidenceLoading] = useState(false),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [loading, setLoading] = useState(true),
    [itemsLoaded, setItemsLoaded] = useState(false),
    [loadError, setLoadError] = useState("");
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    const [resultState, economyState] = await Promise.allSettled([
      apiClient.get<AuditPage>(
        `/api/platform/contributions?${new URLSearchParams({
          ...(status ? { status } : {}),
          page: String(page),
          pageSize: String(pageSize),
        }).toString()}`,
        { accountScoped: true },
      ),
      getPlatformCaritsAudit(),
    ]);
    if (sequence !== requestSequence.current) return;
    const result = resultState.status === "fulfilled" ? resultState.value : null;
    if (result?.success && result.data) {
      setItems(result.data.items);
      setItemsLoaded(true);
      setTotal(result.data.total);
      setTotalPages(result.data.totalPages);
      setPendingCount(result.data.pending);
    } else {
      setItems([]);
      setItemsLoaded(false);
      setTotal(0);
      setTotalPages(0);
      setPendingCount(null);
      setLoadError(result?.message || (resultState.status === "rejected" && resultState.reason instanceof Error ? resultState.reason.message : "贡献审计记录加载失败"));
    }
    if (economyState.status === "fulfilled")
      setEconomy(economyState.value);
    else {
      setEconomy(null);
      setLoadError((current) =>
        [current, economyState.reason instanceof Error ? economyState.reason.message : "Carits 账本摘要加载失败"]
          .filter(Boolean)
          .join("；"),
      );
    }
    setLoading(false);
  }, [page, pageSize, status]);
  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);
  const decide = async () => {
    if (!selected || !action) return;
    if ((action === "reject" || action === "revoke") && reason.trim().length < 10) {
      toast.error("请填写至少 10 个字的审核原因");
      return;
    }
    setSaving(true);
    const endpoint = action === "retry" ? "retry-reward" : action;
    const result = await apiClient.post(
      `/api/platform/contributions/${selected.id}/${endpoint}`,
      action === "reject" || action === "revoke" ? { reason } : undefined,
      { accountScoped: true },
    );
    setSaving(false);
    if (!result.success) return toast.error(result.message || "处理失败");
    const successMessage: Record<ReviewAction, string> = {
      accept: "贡献已接受，奖励进入结算队列",
      reject: "贡献已拒绝",
      revoke: "贡献及经济奖励已撤销",
      retry: "奖励已重新进入结算队列",
    };
    toast.success(successMessage[action]);
    setSelected(null);
    setAction(null);
    setReason("");
    await load();
  };
  const openReview = (item: Event, nextAction: ReviewAction | null = null) => {
    setSelected(item);
    setAction(nextAction);
    setReason("");
  };
  const closeReview = () => {
    if (saving) return;
    setEvidenceDetail(null);
    setSelected(null);
    setAction(null);
    setReason("");
  };
  const openEvidenceDetail = async (kind: EvidenceDetail["kind"]) => {
    const resourceId = kind === "candidate"
      ? selected?.evidence?.candidateId
      : selected?.evidence?.promotedRevisionId;
    if (!selected || !resourceId) {
      toast.error("该贡献没有可用的详情引用");
      return;
    }
    const title = kind === "candidate" ? "Candidate 详情" : "TestSet Revision 详情";
    setEvidenceDetail({ kind, title, data: null, error: "" });
    setEvidenceLoading(true);
    const endpoint = `/api/platform/contributions/${selected.id}/evidence?kind=${kind}`;
    const result = await apiClient.get<unknown>(endpoint, { accountScoped: true });
    setEvidenceLoading(false);
    setEvidenceDetail(current => current?.kind === kind
      ? {
          ...current,
          data: result.success ? result.data ?? null : null,
          error: result.success ? "" : result.message || "证据详情加载失败",
        }
      : current);
  };
  const actionCopy = action
    ? {
        accept: {
          title: "接受贡献并发放奖励",
          description:
            "请核对题目、Candidate 和正式 Revision 证据。接受后会创建奖励任务。",
          submitText: "确认接受",
        },
        reject: {
          title: "拒绝贡献",
          description: "请核对晋升证据并填写可审计的拒绝原因。",
          submitText: "确认拒绝",
        },
        revoke: {
          title: "撤销贡献与奖励",
          description:
            "正式测试版本不会回退；已发放的 Carits币将通过不可变冲正交易撤销。",
          submitText: "确认撤销",
        },
        retry: {
          title: "重试奖励结算",
          description:
            "请先核对贡献证据和失败诊断。确认后只重置奖励任务，不会重复创建贡献或 Revision。",
          submitText: "确认重试",
        },
      }[action]
    : {
        title: "贡献证据",
        description: "查看贡献的晋升来源、规则版本和奖励结算状态。",
        submitText: "",
      };
  return (
    <PageFrame width="workbench">
      <div className={styles.stack}>
        <PageHeader
          title="贡献与奖励审计"
          description="自动晋升直接接受；管理员紧急发布必须由超级管理员确认。平台管理员仅可查看。"
        />
        {loadError && (
          <div className={styles.loadError} role="alert">
            <span>{loadError}</span>
            <Button
              size="sm"
              variant="outline"
              loading={loading}
              onClick={() => void load()}
            >
              重新加载
            </Button>
          </div>
        )}
        <div className={styles.summaryGrid} aria-label="贡献经济摘要">
          <article>
            <span>待审核贡献</span>
            <strong>{pendingCount ?? "—"}</strong>
            <small>{pendingCount === null ? "数据未加载" : "需要超级管理员处理"}</small>
          </article>
          <article>
            <span>累计发放</span>
            <strong>{economy ? `${economy.summary.rewardedCarits} C` : "—"}</strong>
            <small>{economy ? `${economy.summary.rewardCount} 次奖励` : "数据未加载"}</small>
          </article>
          <article>
            <span>累计消费</span>
            <strong>{economy ? `${economy.summary.spentCarits} C` : "—"}</strong>
            <small>{economy ? `${economy.summary.purchaseCount} 次兑换` : "数据未加载"}</small>
          </article>
          <article>
            <span>已购评测额度</span>
            <strong>
              {economy ? economy.summary.purchasedCredits.toLocaleString() : "—"}
            </strong>
            <small>组织匹配奖励未启用</small>
          </article>
        </div>
        <div className={styles.toolbar}>
          <Select
            aria-label="贡献状态"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="accepted">已接受</option>
            <option value="rejected">已拒绝</option>
            <option value="revoked">已撤销</option>
          </Select>
        </div>
        <section>
          <h2 className={styles.sectionTitle}>最近 Carits 账本交易</h2>
          <div className={styles.tableWrap}>
            <TableRoot>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>时间</TableHeaderCell>
                  <TableHeaderCell>类型</TableHeaderCell>
                  <TableHeaderCell>平衡分录</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(economy?.transactions || []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.postedAt ? new Date(item.postedAt).toLocaleString("zh-CN") : "—"}
                    </TableCell>
                    <TableCell>{contributionTypeLabel(item.type)}</TableCell>
                    <TableCell>
                      {item.entries
                        .map(
                          (entry) =>
                            `${entry.ownerLabel} ${entry.amount.startsWith("-") ? "" : "+"}${entry.amount} C`,
                        )
                        .join(" / ")}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && economy && economy.transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>暂无已入账交易</TableCell>
                  </TableRow>
                )}
                {loading && !economy && (
                  <TableRow>
                    <TableCell colSpan={3}>正在加载账本…</TableCell>
                  </TableRow>
                )}
                {!loading && !economy && (
                  <TableRow>
                    <TableCell colSpan={3}>账本加载失败，请重试</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </TableRoot>
          </div>
        </section>
        <div className={styles.tableWrap}>
          <TableRoot>
            <TableHead>
              <TableRow>
                <TableHeaderCell>时间</TableHeaderCell>
                <TableHeaderCell>用户</TableHeaderCell>
                <TableHeaderCell>类型</TableHeaderCell>
                <TableHeaderCell>贡献值</TableHeaderCell>
                <TableHeaderCell>状态/奖励</TableHeaderCell>
                <TableHeaderCell>操作</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </TableCell>
                  <TableCell>{item.Actor.username}</TableCell>
                  <TableCell>{item.type}</TableCell>
                  <TableCell>{item.score}</TableCell>
                  <TableCell>
                    <StatusBadge
                      variant={
                        contributionStatusPresentation(item.status).variant
                      }
                    >
                      {contributionStatusPresentation(item.status).label}
                    </StatusBadge>
                    {item.RewardDelivery && (
                      <span className={styles.rewardState}>
                        <StatusBadge variant={rewardVariant(item.RewardDelivery.status)}>
                          {rewardStatus[item.RewardDelivery.status] || item.RewardDelivery.status}
                        </StatusBadge>
                        <small>{item.RewardDelivery.userCarits} C</small>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className={styles.actions}>
                      <Button size="sm" variant="outline" onClick={() => openReview(item)}>
                        查看证据
                      </Button>
                      {canDecide && item.status === "pending" && (
                        <>
                          <Button size="sm" onClick={() => openReview(item, "accept")}>
                            接受
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReview(item, "reject")}
                          >
                            拒绝
                          </Button>
                        </>
                      )}
                      {canDecide && item.status === "accepted" && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => openReview(item, "revoke")}
                        >
                          撤销
                        </Button>
                      )}
                      {canDecide && item.RewardDelivery?.status === "failed" && (
                        <Button size="sm" onClick={() => openReview(item, "retry")}>
                          重试奖励
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && itemsLoaded && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>暂无符合条件的贡献记录</TableCell>
                </TableRow>
              )}
              {loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>正在加载贡献记录…</TableCell>
                </TableRow>
              )}
              {!loading && !itemsLoaded && (
                <TableRow>
                  <TableCell colSpan={6}>贡献审计记录加载失败，请重试</TableCell>
                </TableRow>
              )}
            </TableBody>
          </TableRoot>
        </div>
        {itemsLoaded && total > 0 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        )}
        <FormDialog
          isOpen={Boolean(selected)}
          onClose={closeReview}
          onSubmit={action ? () => void decide() : undefined}
          loading={saving}
          dirty={Boolean(reason)}
          danger={action === "reject" || action === "revoke"}
          submitText={actionCopy.submitText}
          submitDisabled={
            Boolean(action === "reject" || action === "revoke") &&
            reason.trim().length < 10
          }
          size="lg"
          title={actionCopy.title}
          description={actionCopy.description}
          footer={!action ? (
            <Button variant="secondary" disabled={saving} onClick={closeReview}>
              关闭
            </Button>
          ) : undefined}
        >
          {selected && (
            <div className={styles.evidence}>
              <dl>
                <div>
                  <dt>贡献人</dt>
                  <dd>{selected.Actor.username}</dd>
                </div>
                <div>
                  <dt>贡献类型</dt>
                  <dd>{contributionTypeLabel(selected.type)}</dd>
                </div>
                <div>
                  <dt>来源记录</dt>
                  <dd>{contributionSourceLabel(selected.sourceType)} · {selected.sourceId}</dd>
                </div>
                <div>
                  <dt>题目</dt>
                  <dd>{selected.evidence?.problemId || "—"}</dd>
                </div>
                <div>
                  <dt>Candidate</dt>
                  <dd>
                    {selected.evidence?.candidateId ? (
                      <span className={styles.evidenceAction}>
                        <code>{selected.evidence.candidateId}</code>
                        <Button
                          size="sm"
                          variant="text"
                          onClick={() => void openEvidenceDetail("candidate")}
                        >
                          查看详情
                        </Button>
                      </span>
                    ) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>晋升 Revision</dt>
                  <dd>
                    {selected.evidence?.promotedRevisionId ? (
                      <span className={styles.evidenceAction}>
                        <code>{selected.evidence.promotedRevisionId}</code>
                        <Button
                          size="sm"
                          variant="text"
                          onClick={() => void openEvidenceDetail("revision")}
                        >
                          查看详情
                        </Button>
                      </span>
                    ) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>候选来源</dt>
                  <dd>{candidateSourceLabel(selected.evidence?.candidateSource)}</dd>
                </div>
                <div>
                  <dt>选择方式</dt>
                  <dd>{selectionModeLabel(selected.evidence?.selectionMode)}</dd>
                </div>
                <div>
                  <dt>规则</dt>
                  <dd>
                    {selected.ruleCode
                      ? `${selected.ruleCode} v${selected.ruleVersion || 1}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>组织归因</dt>
                  <dd>
                    {selected.Attribution?.Organization?.name || "个人贡献"}
                    {selected.Attribution?.organizationId && (
                      <small className={styles.identifier}>ID：{selected.Attribution.organizationId}</small>
                    )}
                  </dd>
                </div>
              </dl>
              <div className={styles.rewardDetail}>
                <strong>奖励结算</strong>
                {selected.RewardDelivery ? (
                  <>
                    <StatusBadge variant={rewardVariant(selected.RewardDelivery.status)}>
                      {rewardStatus[selected.RewardDelivery.status] ||
                        selected.RewardDelivery.status}
                    </StatusBadge>
                    <span>{selected.RewardDelivery.userCarits} C</span>
                    {typeof selected.RewardDelivery.attemptCount === "number" && (
                      <span>尝试 {selected.RewardDelivery.attemptCount} 次</span>
                    )}
                    {selected.RewardDelivery.errorMessage && (
                      <code>{selected.RewardDelivery.errorMessage}</code>
                    )}
                  </>
                ) : (
                  <span>尚未创建奖励任务</span>
                )}
              </div>
              {(action === "reject" || action === "revoke") && (
                <label className={styles.reason}>
                  原因（至少 10 个字）
                  <Textarea
                    rows={4}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
            </div>
          )}
        </FormDialog>
        <DetailDialog
          isOpen={Boolean(evidenceDetail)}
          onClose={() => {
            if (!evidenceLoading) setEvidenceDetail(null);
          }}
          title={evidenceDetail?.title || "贡献证据详情"}
          description="以下内容来自现有 Candidate / TestSet Revision 详情接口，审核前请核对状态、哈希和晋升投影。"
          size="xl"
          footer={(
            <Button
              variant="secondary"
              disabled={evidenceLoading}
              onClick={() => setEvidenceDetail(null)}
            >
              关闭
            </Button>
          )}
        >
          <div className={styles.detailBody}>
            {evidenceLoading ? (
              <p>正在加载证据详情…</p>
            ) : evidenceDetail?.error ? (
              <div className={styles.loadError} role="alert">
                <span>{evidenceDetail.error}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openEvidenceDetail(evidenceDetail.kind)}
                >
                  重新加载
                </Button>
              </div>
            ) : (
              <pre className={styles.detailJson}>
                {JSON.stringify(evidenceDetail?.data ?? {}, null, 2)}
              </pre>
            )}
          </div>
        </DetailDialog>
      </div>
    </PageFrame>
  );
}

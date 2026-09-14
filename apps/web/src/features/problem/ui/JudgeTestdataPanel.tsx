"use client";

import type { ChangeEvent, RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/FormControls";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from "@/components/ui/TablePrimitives";
import {
  formatJudgeAssetSize,
  type TestCasePair,
  type TestdataFile,
} from "../model/judgeSettingsTypes";
import styles from "./JudgeSettingsTab.unified.module.css";

type Props = {
  problemId: string;
  stagedFiles: File[];
  stagedPairs: TestCasePair[];
  testdataFiles: TestdataFile[];
  testdataPairs: TestCasePair[];
  uploading: boolean;
  deletingFile: string | null;
  downloadingFile: string | null;
  downloadingAll: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDownloadAll: () => void;
  onDownload: (file: TestdataFile) => void;
  onDelete: (id: string, filename: string) => void;
};

function fileKind(filename: string) {
  if (filename.endsWith(".in")) return "input";
  if (filename.endsWith(".out") || filename.endsWith(".ans")) return "output";
  return "other";
}

export function JudgeTestdataPanel({
  problemId,
  stagedFiles,
  stagedPairs,
  testdataFiles,
  testdataPairs,
  uploading,
  deletingFile,
  downloadingFile,
  downloadingAll,
  fileInputRef,
  onUpload,
  onDownloadAll,
  onDownload,
  onDelete,
}: Props) {
  const pairs = problemId ? testdataPairs : stagedPairs;
  return (
    <div>
      <div className={styles.u51}>
        <p className={styles.u30}>
          支持 .in, .out, .ans, .yaml, .zip 文件。同名配对的 .in 和
          .out/.ans 文件将自动识别为测试点。
          {!problemId && (
            <span className={styles.u52}>
              （创建模式：文件暂存本地，保存题目后自动上传）
            </span>
          )}
        </p>
        <div className={styles.u53}>
          {problemId && testdataFiles.length > 0 && (
            <Button
              variant="outline"
              type="button"
              onClick={onDownloadAll}
              disabled={downloadingAll}
            >
              {downloadingAll ? "下载中..." : "下载数据包"}
            </Button>
          )}
          <label className={styles.uploadButton} data-disabled={uploading}>
            {uploading ? "上传中..." : "上传文件"}
            <Input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={onUpload}
              accept=".in,.out,.ans,.txt,.yaml,.yml,.zip"
              className={styles.u49}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {pairs.length > 0 && (
        <div className={`${styles.settingsCard} ${styles.recognizedCard}`}>
          <div className={`${styles.sectionHeading} ${styles.successTitle}`}>
            已识别测试点 ({pairs.length})
          </div>
          <div className={styles.u20}>
            {pairs.map((pair) => (
              <span key={`${pair.input}:${pair.output}`} className={styles.u54}>
                <span className={styles.u55}>{pair.input}</span>
                <span className={styles.u56}>→</span>
                <span className={styles.u57}>{pair.output}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!problemId ? (
        stagedFiles.length > 0 ? (
          <div className={styles.u58}>
            <TableRoot className={styles.u59}>
              <TableHead>
                <TableRow className={styles.u60}>
                  <TableHeaderCell className={styles.u61}>文件名</TableHeaderCell>
                  <TableHeaderCell className={styles.u62}>大小</TableHeaderCell>
                  <TableHeaderCell className={styles.u62}>状态</TableHeaderCell>
                  <TableHeaderCell className={styles.u63}>操作</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stagedFiles.map((file) => (
                  <TableRow key={file.name} className={styles.u64}>
                    <TableCell className={styles.u65}>
                      <span
                        className={styles.testdataName}
                        data-kind={fileKind(file.name)}
                      >
                        {file.name}
                      </span>
                    </TableCell>
                    <TableCell className={styles.u66}>
                      {formatJudgeAssetSize(file.size)}
                    </TableCell>
                    <TableCell className={styles.u67}>
                      <span className={styles.u68}>待上传</span>
                    </TableCell>
                    <TableCell className={styles.u69}>
                      <Button
                        variant="danger"
                        size="sm"
                        type="button"
                        onClick={() => onDelete("", file.name)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </TableRoot>
          </div>
        ) : (
          <div className={styles.u45}>暂无测试数据，请上传 .in 和 .out/.ans 文件</div>
        )
      ) : testdataFiles.length > 0 ? (
        <div className={styles.u58}>
          <TableRoot className={styles.u59}>
            <TableHead>
              <TableRow className={styles.u60}>
                <TableHeaderCell className={styles.u61}>文件名</TableHeaderCell>
                <TableHeaderCell className={styles.u62}>大小</TableHeaderCell>
                <TableHeaderCell className={styles.u70}>上传时间</TableHeaderCell>
                <TableHeaderCell className={styles.u63}>操作</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {testdataFiles.map((file) => (
                <TableRow key={file.id} className={styles.u64}>
                  <TableCell className={styles.u65}>
                    <span
                      className={styles.testdataName}
                      data-kind={fileKind(file.filename)}
                    >
                      {file.filename}
                    </span>
                  </TableCell>
                  <TableCell className={styles.u66}>
                    {formatJudgeAssetSize(file.size)}
                  </TableCell>
                  <TableCell className={styles.u66}>
                    {new Date(file.uploadedAt).toLocaleString("zh-CN")}
                  </TableCell>
                  <TableCell className={styles.u69}>
                    <div className={styles.u71}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => onDownload(file)}
                        disabled={downloadingFile === file.id}
                      >
                        {downloadingFile === file.id ? "..." : "下载"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        type="button"
                        onClick={() => onDelete(file.id, file.filename)}
                        disabled={deletingFile === file.id}
                      >
                        {deletingFile === file.id ? "..." : "删除"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        </div>
      ) : (
        <div className={styles.u45}>暂无测试数据，请上传 .in 和 .out/.ans 文件</div>
      )}
    </div>
  );
}

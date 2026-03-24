import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin


BASE_URL = "https://www.luogu.com.cn"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": BASE_URL + "/",
}


def get_first_limit(value):
    """limits 可能是数组，也可能为空，统一取第一项"""
    if isinstance(value, list) and value:
        return value[0]
    return value


def format_time_limit(ms):
    if ms is None:
        return "未知"
    if ms % 1000 == 0:
        return f"{ms} ms ({ms // 1000} s)"
    return f"{ms} ms"


def format_memory_limit(kb):
    if kb is None:
        return "未知"
    if kb % 1024 == 0:
        return f"{kb} KB ({kb // 1024} MB)"
    return f"{kb} KB"


def extract_problem_json(html):
    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", {"id": "lentille-context", "type": "application/json"})
    if not script or not script.string:
        raise ValueError("页面中未找到 lentille-context JSON 数据")
    data = json.loads(script.string)
    return data["data"]["problem"]


def fetch_luogu_problem(pid):
    url = f"{BASE_URL}/problem/{pid}"
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return extract_problem_json(resp.text)


def build_attachment_url(item):
    """
    优先使用 downloadLink；
    如果没有 downloadLink，就用 id 拼出下载地址。
    """
    link = (item.get("downloadLink") or "").strip()
    if link:
        # 保险起见，处理一下极少数情况下可能出现的转义斜杠
        link = link.replace("\\/", "/")
        return urljoin(BASE_URL, link)

    attach_id = (item.get("id") or "").strip()
    if attach_id:
        return urljoin(BASE_URL, f"/fe/api/problem/downloadAttachment/{attach_id}")

    return ""


def build_markdown(problem):
    pid = problem.get("pid", "")
    title = problem.get("title", "")
    content = problem.get("content") or problem.get("contenu") or {}

    background = (content.get("background") or "").strip()
    description = (content.get("description") or "").strip()
    input_format = (content.get("formatI") or "").strip()
    output_format = (content.get("formatO") or "").strip()
    hint = (content.get("hint") or "").strip()

    samples = problem.get("samples", []) or []
    attachments = problem.get("attachments", []) or []

    time_limit_ms = get_first_limit(problem.get("limits", {}).get("time"))
    memory_limit_kb = get_first_limit(problem.get("limits", {}).get("memory"))

    parts = []

    # 标题
    parts.append(f"# {pid} {title}")
    parts.append("")

    # 限制
    parts.append("## 题目信息")
    parts.append("")
    parts.append(f"- 时间限制：{format_time_limit(time_limit_ms)}")
    parts.append(f"- 空间限制：{format_memory_limit(memory_limit_kb)}")
    parts.append("")

    # 背景
    if background:
        parts.append("## 题目背景")
        parts.append("")
        parts.append(background)
        parts.append("")

    # 描述
    if description:
        parts.append("## 题目描述")
        parts.append("")
        parts.append(description)
        parts.append("")

    # 输入格式
    if input_format:
        parts.append("## 输入格式")
        parts.append("")
        parts.append(input_format)
        parts.append("")

    # 输出格式
    if output_format:
        parts.append("## 输出格式")
        parts.append("")
        parts.append(output_format)
        parts.append("")

    # 样例
    if samples:
        parts.append("## 样例")
        parts.append("")
        for i, sample in enumerate(samples, 1):
            if isinstance(sample, list) and len(sample) >= 2:
                sample_input = sample[0] or ""
                sample_output = sample[1] or ""
            elif isinstance(sample, dict):
                sample_input = sample.get("input", "") or ""
                sample_output = sample.get("output", "") or ""
            else:
                sample_input = ""
                sample_output = ""

            parts.append(f"### 样例 {i} 输入")
            parts.append("")
            parts.append("```")
            parts.append(sample_input.rstrip("\n"))
            parts.append("```")
            parts.append("")

            parts.append(f"### 样例 {i} 输出")
            parts.append("")
            parts.append("```")
            parts.append(sample_output.rstrip("\n"))
            parts.append("```")
            parts.append("")

    # 提示
    if hint:
        parts.append("## 说明/提示")
        parts.append("")
        parts.append(hint)
        parts.append("")

    # 附件
    if attachments:
        parts.append("## 附加文件")
        parts.append("")
        for item in attachments:
            filename = item.get("filename", "未知文件")
            full_link = build_attachment_url(item)

            # 调试输出
            print(f"[ATTACHMENT] {filename} -> {full_link}")

            if full_link:
                parts.append(f"- [{filename}]({full_link})")
            else:
                parts.append(f"- {filename}")
        parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def main():
    pid = "P14839"

    problem = fetch_luogu_problem(pid)
    markdown_text = build_markdown(problem)

    print("\n" + "=" * 60)
    print(markdown_text)

    output_file = f"{pid}.md"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(markdown_text)

    print("=" * 60)
    print(f"已保存到 {output_file}")


if __name__ == "__main__":
    main()
---
title: "解释DeltaNet GDN (part)"
source: https://chatgpt.com/c/6afffeef-4f40-83ec-bdcf-c4e8c208d433
conversation_id: 6afffeef-4f40-83ec-bdcf-c4e8c208d433
created: 2026-11-20T08:04:06Z
updated: 2026-11-20T09:55:07Z
messages: 34
exported: 2026-11-22
exporter: LightSession 1.2.2
tags: [chatgpt]
---

# 解释DeltaNet GDN (part)

## You · 2026-11-20 16:04

**DeltaNet 递推状态**以 Qwen3.5-0.8B 为代表。该模型包含 18 个 DeltaNet 层与 6 个标准注意力层。每个 DeltaNet 层维护 16 个 `128 * 128` 的状态矩阵 `St`；采用 fp32 存储时单层状态容量为 `1 MiB`。基准实现按 `St[v, k]` 行主序存放，以便沿 `k` 维执行行点积。  什么是 DeltaNet，这是GDN吗？

## ChatGPT · 2026-11-20 16:04

**是的，Qwen3.5-0.8B 使用的就是 GDN（Gated DeltaNet，门控 Delta 网络）。**

但需要区分两个概念：

- **DeltaNet**：基于 *Delta Rule*（误差修正规则）的递推式线性注意力机制。
- **GDN（Gated DeltaNet）**：在 DeltaNet 基础上增加门控机制，控制历史信息的遗忘与新信息的写入。

Qwen3.5-0.8B 使用的是后者。其 24 层结构中，18 层为 Gated DeltaNet，6 层为标准的门控注意力层，按 `GDN → GDN → GDN → Attention` 重复 6 次排列。

#### 1. DeltaNet 究竟是什么？

先理解一个核心区别：**传统 Attention 保存历史 KV Cache，而 DeltaNet 将历史信息压缩到固定大小的状态矩阵 S 中。**

传统 Attention

<svg viewBox="0 0 160 126" width="100%" xmlns="http://www.w3.org/2000/svg">

<path d="M20 95 H139" stroke="currentColor" strokeWidth="1.3"/>
<path d="M132 91 L140 95 L132 99" stroke="currentColor" strokeWidth="1.3" fill="none"/>

历史长度持续增长

</svg>

每增加一个 token，通常都要追加对应的 K、V。

Gated DeltaNet

<svg viewBox="0 0 160 126" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="36" y="12" width="88" height="74" rx="3" fill="#C8E8DE" stroke="#388A73"/>

S

<path d="M80 90 V101" stroke="currentColor" strokeWidth="1.3"/>

固定大小，持续更新

</svg>

每个 token 更新同一个状态矩阵，不需要为所有历史 token 保存 KV。

以你提供的 Qwen3.5-0.8B 参数为例：

每个 GDN 层有 16 个 Head，每个 Head 维护一个 `128 × 128` 的状态矩阵：

$$
S_t\in\mathbb R^{128\times128}
$$

如果采用 FP32：

$$
16\times128\times128\times4
=\boxed{1\ \text{MiB/层}}
$$

18 个 GDN 层的状态矩阵总计 **18 MiB**（按 batch=1 计算，不包括卷积状态和其他运行时数据）。

这里的关键是：即使输入序列由 1K 增加到 100K token，GDN 的递推状态矩阵大小依然不变。

#### 2. 那么 S 是如何更新的？

采用你给出的 `S[v,k]` 存储约定，GDN 的核心递推可以写成：

$$
\begin{aligned}
\bar S_t &= \alpha_t S_{t-1} &&\text{遗忘旧信息}\\
\hat v_t &= \bar S_t k_t &&\text{读取已有记忆}\\
\delta_t &= \beta_t(v_t-\hat v_t) &&\text{计算修正量}\\
S_t &= \bar S_t+\delta_t k_t^T &&\text{更新记忆}\\
o_t &= S_tq_t &&\text{输出}
\end{aligned}
$$

这里：

- $\alpha_t$：遗忘门，决定保留多少历史状态。
- $\beta_t$：写入门，决定修正幅度。
- $k_t,v_t,q_t$：当前 token 生成的 Key、Value、Query。

上述公式采用的是 $S[v,k]$ 矩阵方向；一些实现采用转置方向 $S[k,v]$，因此矩阵乘法顺序会不同，但数学含义一致。

从硬件视角，你提到的行主序存储是有原因的：计算 $\hat v_t=\bar S_tk_t$ 时，每个输出 $v$ 都要对状态矩阵的一整行（128 个 $k$ 元素）执行点积。将 $k$ 维连续存放，有利于顺序读取、向量化 MAC 和带宽利用。

**最值得注意的一点：GDN 不是简单地将 KV Cache 压缩成一个矩阵。它实际上是一个具有遗忘和误差修正机制的递推记忆系统。** 因此，其状态更新涉及矩阵-向量乘法和外积，而不是仅仅向缓存追加数据。

下一步建议从一个具体计算实例入手：**假设一个 GDN Head 只有 $4\times4$ 的状态矩阵，输入一个 token 后，S 的 16 个元素究竟如何变化？** 这个例子可以直接对应到 NPU 的 GEMV、外积、状态读写和数据布局设计。

## You · 2026-11-20 16:06

没理解，请你渐进式解释，每次解释停下来等待我的理解确认。从 head 开始，我一直搞不懂head是什么

## ChatGPT · 2026-11-20 16:06

我们先不讨论 DeltaNet、GDN、KV Cache，也不讨论矩阵计算。

**第一步：只搞清楚 Head（注意力头）是什么，以及为什么需要多个 Head。**

#### 1. Head 到底是什么？

可以把一个 Head 理解为：

**模型内部的一条独立的信息处理通路，负责从输入中提取和处理一组特征。**

假设一个模型接收到一个 Token，经过前面的计算，得到一个包含 8 个数字的向量：

$$
x=[x_0,x_1,x_2,x_3,x_4,x_5,x_6,x_7]
$$

现在希望使用两个 Head 来处理这个 Token。

<svg viewBox="0 0 340 215" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="68" y="8" width="204" height="42" rx="8" fill="#DCEAFB" stroke="#6598D5"/>

输入 Token 特征

x = [x₀, x₁, ... , x₇]

<path d="M170 50 V67 H83 V85 M170 67 H257 V85" stroke="currentColor" strokeWidth="1.5" fill="none"/>
<path d="M79 80 L83 87 L87 80 M253 80 L257 87 L261 80" stroke="currentColor" strokeWidth="1.5" fill="none"/>
<rect x="8" y="88" width="150" height="76" rx="8" fill="#DBEEE9" stroke="#509F89"/>
<rect x="182" y="88" width="150" height="76" rx="8" fill="#F5E8D2" stroke="#C49A59"/>

Head 0

4 维特征

独立处理

Head 1

4 维特征

独立处理

<path d="M83 164 V178 H170 V191 M257 164 V178 H170" stroke="currentColor" strokeWidth="1.5" fill="none"/>
<rect x="90" y="192" width="160" height="22" rx="5" fill="#DCEAFB" stroke="#6598D5"/>

合并两个 Head 的结果

</svg>

示意：两个 Head 分别处理经学习得到的 4 维特征。不是简单把原始输入向量机械切成两半。

注意三个关键点：

1. **Head 不是一个 Token。** 同一个 Token 可以被多个 Head 同时处理。
2. **Head 不是一个独立的神经网络层。** 一个 Layer 内部可以包含多个 Head。
3. **不同 Head 有各自的特征表示和处理状态。** 它们可以学习不同的信息关系，并行计算后再组合结果。

#### 2. 对应到你的 Qwen3.5 GDN

你提供的模型配置中，一个 GDN Layer 有 **16 个 Head**。

可以先简单理解为：

一个 GDN 层里有 16 条并行的信息处理通路，每条通路维护自己的一份 `128 × 128` 状态矩阵。

因此，**16 个 Head 对应 16 份独立的状态矩阵，而不是 16 个 Head 共同操作同一个矩阵。**

这里还不需要理解状态矩阵内部如何计算。

---

**先确认一个理解：**

一个 Token 进入包含 16 个 Head 的层时，是不是意味着同一个 Token 的信息会被送入 16 条并行处理通路，各通路使用自己的特征表示进行计算？

你先回答这个问题，或者指出哪里不理解。确认后，我们再讨论 **为什么同一个 Token 要交给 16 个 Head，而不是只使用一个 Head**。

## You · 2026-11-20 16:08

一个token，经过分词器，生成 1*D 的输入，然后两个head，这里是怎么变成两个head的，不是一分为二吗？比如D=8，head 0 是 x0-x3, head 1 是 x4-x7？还是说两个GEMV？

## ChatGPT · 2026-11-20 16:08

**你的第二种理解更准确：两个 Head 可以理解为两个独立的 GEMV，最后把计算结果拼接起来。**

但实际上，硬件通常可以把这两个 GEMV 合并成一个更大的矩阵乘法。

我们只解释这一步。

#### 1. 假设 D=8，Head=2

首先纠正一个细节：Tokenizer 输出的是 Token ID，经过 Embedding 后才得到 $1\times8$ 的特征向量。

$$
X=[x_0,x_1,x_2,x_3,x_4,x_5,x_6,x_7]
$$

现在有两个 Head，每个 Head 输出 4 维。

关键问题：**Head 0 是直接取 x0～x3 吗？**

不是。标准多头注意力中，通常先进行线性投影。

<svg viewBox="0 0 340 240" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="64" y="6" width="212" height="39" rx="6" fill="#DCEAFB" stroke="#6492C6"/>

输入 X [1, 8]

x₀ x₁ x₂ x₃ x₄ x₅ x₆ x₇

<path d="M170 45 V59 H86 V76 M170 59 H254 V76" stroke="currentColor" fill="none" strokeWidth="1.5"/>
<path d="M82 71 L86 77 L90 71 M250 71 L254 77 L258 71" stroke="currentColor" fill="none" strokeWidth="1.4"/>
<rect x="9" y="78" width="153" height="80" rx="7" fill="#DCEFE9" stroke="#549781"/>
<rect x="178" y="78" width="153" height="80" rx="7" fill="#F5E9D6" stroke="#C79F68"/>

Head 0

X × W₀

[1,8] × [8,4]

Head 1

X × W₁

[1,8] × [8,4]

<path d="M85 158 V179 M254 158 V179" stroke="currentColor" strokeWidth="1.5"/>
<rect x="32" y="180" width="106" height="30" rx="5" fill="#DCEFE9" stroke="#549781"/>
<rect x="202" y="180" width="106" height="30" rx="5" fill="#F5E9D6" stroke="#C79F68"/>

输出 [1,4]

输出 [1,4]

<path d="M85 210 V222 H170 M255 210 V222 H170 V231" fill="none" stroke="currentColor" strokeWidth="1.5"/>

拼接 → [1,8]

</svg>

注意：**每个 Head 都使用完整的 8 维输入，而不是只使用其中 4 维。**

例如 Head 0 的第一个输出：

$$
y_0=x_0w_{0,0}+x_1w_{1,0}+\cdots+x_7w_{7,0}
$$

因此，Head 0 的 4 个输出都可以包含全部 8 个输入特征的信息。

#### 2. 但在硬件上，真的需要执行两次 GEMV 吗？

不需要。

把两个权重矩阵按列拼接：

$$
W=[W_0\mid W_1]\in\mathbb R^{8\times8}
$$

直接执行：

$$
Y=XW
$$

$$
[1,8]\times[8,8]\rightarrow[1,8]
$$

之后按输出维度切分：

- Head 0：`Y[0:4]`
- Head 1：`Y[4:8]`

所以这里其实存在两种等价的实现方式：

| 实现 | GEMV 规模 |
|---|---|
| 两个 Head 分开计算 | 2 次 `[1,8] × [8,4]` |
| 两个 Head 合并计算 | 1 次 `[1,8] × [8,8]` |

两种方式的数学结果相同（浮点计算可能有舍入差异）。

**所以你的“一分为二”并非完全错误：确实会切分，但通常切分的是线性投影后的输出 Y，而不是原始输入 X。**

这里我们暂时只讨论一次线性投影。标准 Attention 实际还涉及 Q、K、V 三组投影，GDN 的情况又有所不同。

---

**到这里，确认一下：**

假设 `D=8，Head=2`，是否理解了两个 Head 各自使用完整的 8 维输入，分别生成 4 维结果，而这两个 GEMV 可以合并成一个大的 GEMV？

确认后，我们再讨论：**为什么 Attention 需要 Q、K、V，以及 Head 究竟对应 Q、K、V 中的哪一个。**

## You · 2026-11-20 16:10

理解了

## ChatGPT · 2026-11-20 16:10

接下来我们只讨论一个问题：**一个 Head 内部到底有什么？为什么需要 Q、K、V？**

#### 1. 一个 Attention Head 包含 Q、K、V 三组向量

继续使用刚才的例子：

- 输入维度：`D = 8`
- Head 数量：`H = 2`
- 每个 Head 的维度：`d = 4`

刚才只讨论了一组线性投影。实际上，标准 Multi-Head Attention 需要三组投影：

$$
Q=XW_Q,\quad K=XW_K,\quad V=XW_V
$$

其中：

$$
X:[1,8],\quad W_Q,W_K,W_V:[8,8]
$$

因此得到：

$$
Q,K,V:[1,8]
$$

随后分别按 Head 切分：

<svg viewBox="0 0 340 235" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="104" y="5" width="132" height="32" rx="6" fill="#DCEAFB" stroke="#7199C7"/>

X [1,8]

<path d="M30 153 V178 H170 M143 153 V178 M256 153 V178 H170" stroke="#3F85C9" strokeWidth="1.1" strokeDasharray="4 3" fill="none"/>
<rect x="65" y="183" width="210" height="43" rx="7" fill="#DCEFE9" stroke="#519985"/>

每个 Head 获得自己的 Q、K、V

每组向量均为 4 维

</svg>

所以，**Head 0 不是只有 Q，也不是只有 K 或 V，而是同时拥有：**

$$
Head_0=(Q_0,K_0,V_0)
$$

$$
Head_1=(Q_1,K_1,V_1)
$$

每个 Head 都拥有自己对应的 Q、K、V 特征。

#### 2. Q、K、V 分别干什么？

假设模型正在处理一句话：

“**小明拿起杯子，因为他想喝水。**”

当模型处理“他”这个 Token 时：

- **Q（Query）**：当前 Token 想查询什么信息，例如“他”指的是谁？
- **K（Key）**：历史 Token 提供的匹配特征，例如“小明”的身份特征。
- **V（Value）**：历史 Token 实际提供给当前 Token 的信息。

Attention 先用 Q 和历史 K 计算匹配程度，再依据匹配权重对历史 V 加权求和。

因此，一个 Head 完成的事情是：

$$
\boxed{\text{用 Q 匹配 K，再从 V 读取信息}}
$$

不同 Head 拥有不同的投影参数，可以学习不同的信息匹配方式。

这里的 Q、K、V 不是人为指定的语义标签，而是训练过程中学习出来的数值向量。

---

**现在确认第二个概念：**

对于 `D=8、H=2` 的标准多头注意力：

每个 Token 会生成 Q、K、V 三个 8 维向量，然后每个向量切分成两组 4 维向量。

因此每个 Head 都拿到一组自己的 `Q[4]、K[4]、V[4]`。

这一步能理解吗？

确认后，我们再讨论一个更关键的问题：**Q、K、V 如何参与实际 GEMV/GEMM 计算，以及一个 Head 为什么需要读取历史 Token。**

## You · 2026-11-20 16:11

理解了

## ChatGPT · 2026-11-20 16:11

接下来是第三步：**一个 Head 如何利用 Q、K、V，从历史 Token 中读取信息？**

这一步非常关键。理解之后，就能区分传统 Attention 的 KV Cache 和 DeltaNet 的递推状态矩阵。

#### 1. 假设当前正在生成第 4 个 Token

继续使用之前的配置：

- `D = 8`
- `Head = 2`
- `head_dim = 4`

现在只观察 **Head 0**，假设前面已经处理了 3 个 Token，当前正在处理第 4 个 Token。

在 Decode 阶段，当前 Token 生成：

$$
q_4,k_4,v_4\in\mathbb R^{1\times4}
$$

与此同时，Head 0 的 KV Cache 中已经保存了前三个 Token 的 K、V。

把当前 Token 的 K、V 也加入后：

$$
K=
\begin{bmatrix}
k_1\\k_2\\k_3\\k_4
\end{bmatrix}
\in\mathbb R^{4\times4}
$$

$$
V=
\begin{bmatrix}
v_1\\v_2\\v_3\\v_4
\end{bmatrix}
\in\mathbb R^{4\times4}
$$

#### 2. 一个 Head 的计算过程

<svg viewBox="0 0 340 294" width="100%" xmlns="http://www.w3.org/2000/svg">

第一步：Q 和历史 K 匹配

<rect x="13" y="34" width="83" height="35" rx="5" fill="#DBEAFE" stroke="#598AC9"/>

Q [1,4]

当前 Token

×

<rect x="133" y="26" width="75" height="52" rx="5" fill="#D6EFE7" stroke="#519D83"/>

Kᵀ [4,4]

=

<rect x="248" y="34" width="79" height="35" rx="5" fill="#F6E8CE" stroke="#C39856"/>

Scores

[1,4]

<path d="M287 70 V90" stroke="currentColor" strokeWidth="1.5"/>
<path d="M283 84 L287 91 L291 84" fill="none" stroke="currentColor" strokeWidth="1.5"/>
<rect x="220" y="94" width="117" height="33" rx="5" fill="#F6E8CE" stroke="#C39856"/>

Softmax [1,4]

第二步：根据匹配权重读取 V

<rect x="13" y="172" width="126" height="45" rx="5" fill="#F6E8CE" stroke="#C39856"/>

注意力权重 S

[1,4]

×

<rect x="180" y="172" width="90" height="45" rx="5" fill="#D6EFE7" stroke="#519D83"/>

V [4,4]

历史 + 当前

<path d="M137 226 V244 H169 M231 226 V244 H169 V257" fill="none" stroke="currentColor" strokeWidth="1.5"/>
<rect x="78" y="260" width="182" height="30" rx="6" fill="#DBEAFE" stroke="#598AC9"/>

Head 0 输出 [1,4]

</svg>

整个计算只需要理解两个矩阵乘法。

**第一次矩阵乘法：**

$$
[1,4]\times[4,4]\rightarrow[1,4]
$$

当前 Q 与 4 个 Token 的 K 分别进行点积，得到 4 个匹配分数。

经过 Softmax，假设得到：

$$
S=[0.1,\ 0.6,\ 0.2,\ 0.1]
$$

这表示当前 Token 对第二个 Token 的注意力权重最大。

**第二次矩阵乘法：**

$$
O=SV
$$

$$
[1,4]\times[4,4]\rightarrow[1,4]
$$

相当于：

$$
O=0.1v_1+0.6v_2+0.2v_3+0.1v_4
$$

最终 Head 0 得到一个 4 维输出向量。

而 Head 1 使用自己独立的 Q、K、V，执行同样的过程，也得到一个 4 维输出向量。

两个 Head 的输出拼接：

$$
[1,4]+[1,4]\xrightarrow{\text{Concat}}[1,8]
$$

这里的 `[1,8]` 还可以经过 Attention 的输出线性投影。

---

#### 3. 从 NPU 硬件角度理解

在 Decode 阶段，一个 Head 的核心计算可以看成：

| 操作 | 计算形状 | 硬件运算 |
|---|---|---|
| $QK^T$ | `[1,4] × [4,4]` | GEMV |
| Softmax | `[1,4]` | 归一化 |
| $SV$ | `[1,4] × [4,4]` | GEMV |

当历史 Token 增加到 1000 个时：

$$
QK^T:[1,4]\times[4,1000]
$$

$$
SV:[1,1000]\times[1000,4]
$$

注意，这两个 GEMV 的计算量都会随历史长度增长。

这也正是 DeltaNet 要改变的地方。

---

**先确认第三步的理解：**

一个 Head 在 Decode 阶段，使用当前 Token 的 Q 与历史（包括当前）的 K 进行匹配，再根据匹配权重对 V 加权求和。

所以 **一个 Head 不只是处理当前 Token，还需要访问过去 Token 的信息**。

你是否理解这个过程？特别是为什么 $QK^T$ 得到的是 4 个匹配分数，而 $SV$ 最终得到的是 4 维特征向量？

确认后，我们再进入 DeltaNet，看看它如何使用一个固定的 `128 × 128` 状态矩阵替代不断增长的 KV Cache。

## You · 2026-11-20 16:26

理解了，进入 DeltaNet之前，我想知道KV cache 是怎么存放的，首先我知道是按layer存放的，每个layer下是多个head。其中是每个head，head内按照K和V存放，还是按K，V，再是各自的head呢？

## ChatGPT · 2026-11-20 16:26

你问的是 **KV Cache 在内存中的组织方式（Memory Layout）**。这需要区分两个层面：逻辑组织方式和物理存储布局。

先给出结论：**常见实现是你说的第二种：Layer → K/V → Head → Token → Feature。**

但这不是 Attention 算法强制规定的，具体物理布局可以不同。

#### 1. KV Cache 的逻辑组织

继续使用前面的例子：

- 2 个 Layer
- 每层 2 个 Head
- 已经处理 3 个 Token
- 每个 Head 的维度为 4

一个常见的组织方式如下：

<svg viewBox="0 0 340 264" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="95" y="5" width="150" height="32" rx="6" fill="#DCEAFB" stroke="#6E99C6"/>

KV Cache

<path d="M170 37 V47 H83 V59 M170 47 H257 V59" fill="none" stroke="currentColor" strokeWidth="1.2"/>
<rect x="22" y="60" width="122" height="29" rx="5" fill="#DFE8F4" stroke="#8199B5"/>
<rect x="196" y="60" width="122" height="29" rx="5" fill="#DFE8F4" stroke="#8199B5"/>

Layer 0

Layer 1

<path d="M83 89 V105 H49 V117 M83 105 H117 V117" stroke="currentColor" strokeWidth="1.2" fill="none"/>
<path d="M257 89 V105 H223 V117 M257 105 H291 V117" stroke="currentColor" strokeWidth="1.2" fill="none"/>

<path d="M44 146 V162 H25 V174 M44 162 H63 V174" stroke="#3B91B0" strokeWidth="1.2" fill="none"/>
<path d="M122 146 V162 H103 V174 M122 162 H141 V174" stroke="#B88840" strokeWidth="1.2" fill="none"/>

<rect x="184" y="161" width="141" height="66" rx="5" fill="none" stroke="#8194A7" strokeDasharray="4 3"/>

Layer 1 同样结构

每个 K/V 各包含

Head 0、Head 1

<path d="M23 201 V223" stroke="#3B91B0" strokeWidth="1.3"/>
<rect x="4" y="226" width="153" height="34" rx="5" fill="#DDF0F3" stroke="#3B91B0"/>

Head 0 的 K

3 Token × 4 Feature

</svg>

比如 Layer 0 的 K Cache，可以用一个四维 Tensor 表示：

$$
K_{\mathrm{cache}}:[B,H,T,d]
$$

其中：

| 维度 | 含义 | 示例 |
|---|---|---|
| B | Batch size | 1 |
| H | KV Head 数量 | 2 |
| T | 已缓存的 Token 数量 | 3 |
| d | 每个 Head 的特征维度 | 4 |

所以：

$$
K_{\mathrm{cache}}:[1,2,3,4]
$$

V Cache 也是：

$$
V_{\mathrm{cache}}:[1,2,3,4]
$$

对于 Head 0，K Cache 中存放的是：

$$
K_0=
\begin{bmatrix}
k_{1,0}&k_{1,1}&k_{1,2}&k_{1,3}\\
k_{2,0}&k_{2,1}&k_{2,2}&k_{2,3}\\
k_{3,0}&k_{3,1}&k_{3,2}&k_{3,3}
\end{bmatrix}
$$

即连续三个 Token 在这个 Head 下的 K 向量。

#### 2. 但物理内存布局不一定如此

对于 NPU 实现，需要特别注意：

`[B,H,T,d]` 和 `[B,T,H,d]` 是两种不同的物理排列。

前者让同一个 Head 的不同 Token 相邻存放；后者让同一个 Token 的不同 Head 相邻存放。它们各有利于不同的数据访问模式。

此外，一些实现还会对 K 进行转置、分块，或者使用 Paged KV Cache。

所以 **Attention 的数学计算并不限定 KV Cache 的内存排列顺序，真正决定物理地址的是 Tensor Layout 和 Stride。**

---

我们先停在这里。

**确认一个问题：** 假设 `K_cache` 的布局是 `[B,H,T,d]`，那么 `K_cache[0,1,:,:]` 取出来的，是不是 Batch 0、Head 1 的全部历史 Token 的 K 矩阵，形状为 `[T,d]`？

理解后，我们再讨论不同布局为什么会影响 NPU 的 DMA 访问与 GEMV 性能。

## You · 2026-11-20 16:28

理解了，回到 DeltaNet 本身

## ChatGPT · 2026-11-20 16:28

我们继续，仍然一次只讨论一个概念。

#### 第四步：DeltaNet 为什么需要状态矩阵 S？

刚才已经理解，传统 Attention 在 Decode 阶段，需要读取历史 Token 的 K、V。

**DeltaNet 的核心变化是：不再保存每个历史 Token 的 K、V，而是把历史信息持续写入一个固定大小的状态矩阵 S。**

先不管它如何写入，只看它如何读取。

##### 1. 传统 Attention

假设一个 Head 的维度为 4，已经处理了 100 个 Token。

那么它保存：

$$
K_{\text{cache}}:[100,4]
$$

$$
V_{\text{cache}}:[100,4]
$$

新的 Token 到来时：

$$
QK^T\rightarrow Softmax\rightarrow SV
$$

计算需要访问历史的 100 组 K、V。

如果历史长度变成 10000，缓存就变成 `[10000,4]`。

##### 2. DeltaNet

DeltaNet 不再为每个 Token 保留独立的 K、V，而是维护：

$$
S:[4,4]
$$

新的 Token 到来时，产生一个 Query：

$$
q:[4,1]
$$

然后直接计算：

$$
\boxed{o=S q}
$$

$$
[4,4]\times[4,1]\rightarrow[4,1]
$$

<svg viewBox="0 0 330 159" width="100%" xmlns="http://www.w3.org/2000/svg">

状态矩阵 S

Query q

输出 o

×

=

[4,4]

[4,1]

[4,1]

</svg>

从 NPU 角度，这就是一个非常明确的 GEMV 操作。

无论之前处理了 100 个 Token，还是 10000 个 Token：

- S 的形状始终是 `[4,4]`。
- 当前 q 的形状始终是 `[4,1]`。
- 输出始终是 `[4,1]`。

##### 3. 对应 Qwen3.5-0.8B

其 Gated DeltaNet 层包含 16 个 Head，每个 Head 的 Q/K/V 维度为 128。

因此，每个 Head：

$$
S:[128,128],\quad q:[128,1]
$$

$$
o=S q\rightarrow[128,1]
$$

16 个 Head 各有一个 S，总共：

$$
16\times128\times128\times4B=1\text{ MiB}
$$

这就是你最开始提到的 **每层 1 MiB 递推状态**。

不过，要特别注意：**S 不是完整 KV Cache 的无损压缩，也不能直接等同于传统 Softmax Attention。** 它通过递推更新学习一种固定容量的历史记忆表示。

---

现在先确认一个关键理解：

**传统 Attention 的历史信息保存在不断增长的 K、V 矩阵里；DeltaNet 则将历史信息保存在固定的状态矩阵 S 里。当前 Token 可以通过 $S q$ 读取历史信息。**

这一步是否理解？

如果理解了，下一步我们只讨论一个问题：**新 Token 到来时，K、V 究竟如何写入 S？为什么这个更新规则叫 Delta Rule？**

## You · 2026-11-20 16:36

理解了

## ChatGPT · 2026-11-20 16:36

我们进入第五步：**DeltaNet 如何把新 Token 的 K、V 写入状态矩阵 S？**

这一步先不讨论 Gating（门控），只理解最核心的 **Delta Rule（差值更新规则）**。

#### 1. 先理解 S 到底存储了什么

传统 Attention 使用 KV Cache 保存每个 Token 的 K、V。

DeltaNet 则将 S 看作一个可持续更新的映射关系：

$$
\boxed{K \xrightarrow{S} V}
$$

也就是说，给定一个 Key，状态矩阵 S 尝试输出与它关联的 Value：

$$
\hat v=Sk
$$

这里的 $\hat v$ 是根据已有状态读出的预测值，不一定等于当前 Token 的真实 $v$。

因此，每个新 Token 都会提供一组新的 `(k, v)`，用于修正 S 中已有的映射关系。

#### 2. 用一个 2×2 状态矩阵举例

假设 Head 的维度只有 2。

已有状态：

$$
S_{\text{old}}=
\begin{bmatrix}
1&2\\
4&6
\end{bmatrix}
$$

现在来了一个新 Token，它产生：

$$
k=\begin{bmatrix}1\\0\end{bmatrix},
\qquad
v=\begin{bmatrix}3\\5\end{bmatrix}
$$

我们的目标是：让 S 在收到这个 k 时，能够读出 v。

第一步：读取旧状态对 k 的预测

$$
\hat v=S_k
=\begin1\\4\end
$$

但新 Token 希望得到的是：

$$
v=\begin3\\5\end
$$

第二步：计算预测误差 Delta

$$
\delta=v-\hat v
=\begin2\\1\end
$$

也就是第一个输出差 2，第二个输出差 1。

第三步：把误差写回状态矩阵

假设写入强度 $\beta=1$，执行一次外积：

$$
\Delta S=\delta k^T
=\begin2&0\\1&0\end
$$

然后更新：

$$
S_=S_+\Delta S
$$

- 更新前 · <svg viewBox="0 0 140 86" width="100%"> · </svg>
- 更新后 · <svg viewBox="0 0 140 86" width="100%"> · </svg>

绿色表示本次更新改变的元素。这里由于 k = [1,0]，只修改第一列；一般的 k 会同时影响多列。

最后验证一下：

$$
S_{\text{new}}k=
\begin{bmatrix}
3&2\\
5&6
\end{bmatrix}
\begin{bmatrix}1\\0\end{bmatrix}
=
\begin{bmatrix}3\\5\end{bmatrix}
=v
$$

更新成功。这个例子中，由于 k 是单位向量且 $\beta=1$，一次更新恰好消除了预测误差；一般情况下不一定完全消除。

#### 3. 这就是 Delta Rule

写成通用公式：

$$
\boxed{
S_t=S_{t-1}+\beta_t
\underbrace{(v_t-S_{t-1}k_t)}_{\text{Delta：预测误差}}
k_t^T
}
$$

其中 $\beta_t$ 控制更新强度。

它与直接累加 $v_tk_t^T$ 的区别在于：**DeltaNet 先读取旧记忆，再根据误差修正，而不是无条件把新信息叠加进去。** 

从 NPU 硬件角度，这个更新涉及一次 GEMV、一次向量减法、一次外积和状态矩阵写回。

---

现在先确认：

**DeltaNet 中的 S 可以理解成一张不断被修正的 K→V 映射表。每当新 Token 到来，先使用 k 从旧 S 读出预测值，再根据预测值与当前 v 的差值更新 S。**

你是否理解了这个过程，尤其是为什么需要先计算 `S × k`，而不是直接将 `v × kᵀ` 累加进去？

确认后，我们再引入 GDN 的遗忘门 $\alpha$，看看它相比 DeltaNet 增加了什么。

## You · 2026-11-20 16:55

这里好像和q没关系，k和v都是[2,1]，我没理解为什么只更新第一列，如果只更新第一列，因为每次decode维度都是1，所以只有第一列会一直被更新，很奇怪

## ChatGPT · 2026-11-20 16:56

你的质疑是对的。前面的例子选了一个特殊的 $k=[1,0]^T$，容易造成误解。

**关键是：`[2,1]` 表示一个包含 2 个特征的列向量，并不代表它的值是 `[1,0]`，也不意味着只更新第一列。**

我们先把这个问题彻底搞清楚，暂时不引入 Gating。

#### 1. 为什么上次只更新第一列？

上次选择：

$$
k=\begin{bmatrix}1\\0\end{bmatrix}
$$

DeltaNet 的更新公式是：

$$
S_{\text{new}}=S_{\text{old}}+\beta(v-S_{\text{old}}k)k^T
$$

其中更新量：

$$
\Delta S=\beta\delta k^T
$$

假设误差为：

$$
\delta=\begin{bmatrix}2\\1\end{bmatrix}
$$

那么：

$$
\Delta S=
\begin{bmatrix}2\\1\end{bmatrix}
\begin{bmatrix}1&0\end{bmatrix}
=
\begin{bmatrix}2&0\\1&0\end{bmatrix}
$$

因为 $k$ 的第二个元素恰好为 0，所以第二列没有变化。

**这只是特例，不是 DeltaNet 每次更新的规律。**

#### 2. 换一个正常的 K 向量

仍然是一个 Token，Head 维度为 2。

假设这个 Token 生成：

$$
k=\begin{bmatrix}1\\1\end{bmatrix},
\qquad
v=\begin{bmatrix}5\\12\end{bmatrix}
$$

旧状态为：

$$
S_{\text{old}}=
\begin{bmatrix}1&2\\4&6\end{bmatrix}
$$

先读取旧状态：

$$
\hat v=S_{\text{old}}k
=\begin{bmatrix}3\\10\end{bmatrix}
$$

计算误差：

$$
\delta=v-\hat v
=\begin{bmatrix}2\\2\end{bmatrix}
$$

假设更新系数 $\beta=0.5$。

于是：

$$
\Delta S=0.5
\begin{bmatrix}2\\2\end{bmatrix}
\begin{bmatrix}1&1\end{bmatrix}
=
\begin{bmatrix}1&1\\1&1\end{bmatrix}
$$

本次更新：S_new = S_old + ΔS

看到了吗？**现在 S 的两列、四个元素全部更新了。**

实际模型的 K 通常是稠密向量，128 个特征大多不为零，因此一次 Token 更新就可能改变整个 `128 × 128` 状态矩阵。

#### 3. 那 Q 去哪里了？

你观察得也对：到目前为止，状态更新公式确实没有 Q。

因为在 DeltaNet 中，K、V 和 Q 的作用不同：

- **K 和 V：** 用于更新状态 S，也就是写入记忆。
- **Q：** 用于从更新后的状态 S 中读取输出。

$$
\underbrace{(k_t,v_t)\longrightarrow S_t}_{\text{写入}}
$$

$$
\underbrace{S_tq_t\longrightarrow o_t}_{\text{读取}}
$$

因此一个 Token 的处理过程包含写入和读取两个部分。Q 不直接参与上面这个 Delta Rule 的状态更新公式。

---

现在我们先确认一个很重要的概念：

**在 Decode 阶段，每次处理 1 个 Token，不代表 K 只有 1 个有效元素。**

对于 `head_dim=128`，当前 Token 的 K 仍然包含 128 个特征值，是 `[128,1]` 的列向量。

它与误差向量做外积，会生成一个 `[128,128]` 的更新矩阵，因此可能更新 S 的所有 16384 个元素。

这个区别是否理解了？如果理解了，我们下一步再研究：**为什么一次 Token 更新要修改整个 S，以及这种更新会不会破坏之前 Token 写入的记忆。**

## You · 2026-11-20 16:59

理解了

## ChatGPT · 2026-11-20 16:59

接下来是第六步：**DeltaNet 更新状态矩阵 S 时，会不会破坏之前 Token 写入的记忆？**

答案是：**会，而且这是 DeltaNet 一个非常重要的特性。**

我们仍然使用 `head_dim=2`，只看一个 Head。

#### 1. 第一个 Token 写入记忆

初始状态矩阵为零：

$$
S_0=\begin{bmatrix}0&0\\0&0\end{bmatrix}
$$

第一个 Token：

$$
k_1=\begin{bmatrix}1\\0\end{bmatrix},
\qquad
v_1=\begin{bmatrix}2\\0\end{bmatrix}
$$

假设 $\beta_1=1$，根据 Delta Rule：

$$
S_1=\begin{bmatrix}2&0\\0&0\end{bmatrix}
$$

此时使用 $k_1$ 读取：

$$
S_1k_1=\begin{bmatrix}2\\0\end{bmatrix}=v_1
$$

说明第一个 Token 的映射已经写入成功。

#### 2. 第二个 Token 写入记忆

第二个 Token：

$$
k_2=\begin{bmatrix}1\\1\end{bmatrix},
\qquad
v_2=\begin{bmatrix}0\\2\end{bmatrix}
$$

先读取旧状态：

$$
S_1k_2=\begin{bmatrix}2\\0\end{bmatrix}
$$

计算预测误差：

$$
\delta_2=v_2-S_1k_2
=\begin{bmatrix}-2\\2\end{bmatrix}
$$

假设 $\beta_2=0.5$，执行外积更新：

$$
\Delta S_2=0.5\delta_2k_2^T
=\begin{bmatrix}-1&-1\\1&1\end{bmatrix}
$$

得到：

$$
S_2=\begin{bmatrix}1&-1\\1&1\end{bmatrix}
$$

- 第一个 Token 写入后 · S₁
- 第二个 Token 写入后 · S₂：四个元素都发生变化

#### 3. 现在还能读取第一个 Token 的记忆吗？

用原来的 $k_1$ 读取新状态：

$$
S_2k_1=
\begin{bmatrix}1\\1\end{bmatrix}
$$

但是第一个 Token 希望得到的是：

$$
v_1=\begin{bmatrix}2\\0\end{bmatrix}
$$

**结果变了！第二个 Token 的写入干扰了第一个 Token 的记忆。**

反过来，使用 $k_2$ 读取：

$$
S_2k_2=\begin{bmatrix}0\\2\end{bmatrix}=v_2
$$

第二个 Token 的映射则被正确写入。

#### 4. 为什么会产生干扰？

这里有一个重要的数学关系。

当新 Token 写入时，旧 Key 对应的读取结果变化为：

$$
\boxed{
\Delta(Sk_{\text{old}})
=\beta\delta(k_{\text{new}}^Tk_{\text{old}})
}
$$

其中：

$$
k_{\text{new}}^Tk_{\text{old}}
$$

就是新旧两个 Key 的内积。

这说明：

- 如果两个 Key 正交，内积为 0，那么这次写入不会改变旧 Key 的读取结果。
- 如果两个 Key 不正交，新 Token 的写入就可能影响旧记忆。
- 干扰程度还取决于误差向量 $\delta$ 和更新强度 $\beta$。

因此，**S 并不是像 KV Cache 一样，为每个 Token 分配一个独立的存储位置。不同 Token 的信息是叠加在同一个矩阵中的。**

这也解释了为什么固定大小的 S 不能无损保存无限多的历史信息。

---

我们先停在这里。

**理解确认：** DeltaNet 的状态 S 是一份共享的记忆。不同 Token 通过不同的 K 向量向 S 写入信息。如果 Key 之间存在重叠，新的写入就可能修改旧 Token 的映射。

你是否理解了这种**记忆干扰（Memory Interference）**？

理解后，我们再讨论 GDN 的门控机制：它如何控制历史信息的遗忘，以及为什么要在 Delta Rule 基础上增加 Gating。

## You · 2026-11-20 17:02

我这里有两个问题：1. 为什么k和v的维度是[2,.1]，不是[1,2]，这个和之前的表达好像不太一样；2. key 正交是什么意思？正常场景下，很难正交吧，这是数学上的，对于真实语义上有对应吗？

## ChatGPT · 2026-11-20 17:02

这两个问题都很关键。尤其是第二个问题，涉及 DeltaNet 在真实语言模型中如何存储语义信息。

我们按照顺序来，**先解决第一个问题：为什么之前 K、V 是 `[1,2]`，现在却变成 `[2,1]`？**

#### 1. 其实是同一个向量，只是矩阵表示方向不同

你之前的理解没有错。

假设 `head_dim=2`，Decode 阶段每次处理一个 Token。

按照常见的深度学习 Tensor 表示：

$$
K=[k_0,k_1]\qquad [1,2]
$$

这是一个行向量。

但在刚才的 DeltaNet 公式里，我将其转置成列向量：

$$
k=\begin{bmatrix}k_0\\k_1\end{bmatrix}\qquad[2,1]
$$

**二者携带的信息完全相同，只是转置关系。**

$$
k=K^T
$$

#### 2. 为什么 DeltaNet 使用列向量？

这是为了方便表达状态矩阵的数学运算，而不是硬件或算法要求 K 必须按列存储。

写成列向量时

$$
S:[2,2],\quad k:[2,1],\quad v:[2,1]
$$

从状态 S 中读取预测值：

$$
\hat v=Sk\qquad [2,2]\times[2,1]\rightarrow[2,1]
$$

更新状态：

$$
S_=S_+\beta(v-\hat v)k^T
$$

如果始终使用你熟悉的行向量

$$
S':[2,2],\quad K:[1,2],\quad V:[1,2]
$$

读取预测值：

$$
\hat V=KS'\qquad [1,2]\times[2,2]\rightarrow[1,2]
$$

更新状态：

$$
S'_=S'_+\beta K^T(V-\hat V)
$$

这里 $S'=S^T$。两种写法完全等价，只是状态矩阵的方向也随之转置。

特别注意：**Tensor 的数学形状不等于物理内存布局。** 真正如何在 DDR 或 VMEM 中存放，还取决于 Layout 和 Stride。

对于最开始提到的 `St[v,k]`，它对应的就是第一种矩阵方向，计算时采用 $S k$。

---

现在先确认第一点：

**Decode 阶段一个 Token 产生的 K 始终是一个包含 `head_dim` 个特征的向量。之前用 `[1,2]` 表示，现在用 `[2,1]` 表示，仅仅是数学上的转置，并不是 Token 数量或者 Head 维度发生了改变。**

这一步是否理解？

确认后，我们专门讨论第二个问题：**Key 正交的几何意义是什么？为什么真实 Token 的 Key 不一定正交？数学上的 Key 相似性与语义相似性究竟是什么关系？**

## You · 2026-11-20 17:03

理解了，继续

## ChatGPT · 2026-11-20 17:03

接下来讨论第二个问题：**Key 正交是什么意思？真实语言模型中的 Key 是否可能正交？它与语义有什么关系？**

你的直觉是对的：真实模型中，不可能要求不同 Token 的 Key 都严格正交。但有一个容易忽略的区别：**数学上严格正交，与高维空间中近似正交，是两回事。**

#### 1. 什么是 Key 正交？

继续假设 `head_dim=2`。

现在有两个 Token，生成两个 Key：

$$
k_1=\begin{bmatrix}1\\0\end{bmatrix},
\qquad
k_2=\begin{bmatrix}0\\1\end{bmatrix}
$$

计算内积：

$$
k_1^Tk_2=1\times0+0\times1=0
$$

内积为 0，就称两个向量**正交（Orthogonal）**。

几何意义很简单：两个向量互相垂直。

<svg viewBox="0 0 320 175" width="100%" xmlns="http://www.w3.org/2000/svg">
<defs>
<marker id="ortharr1" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#238B73"/></marker>
<marker id="ortharr2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#CC8B37"/></marker>
</defs>
<g>

正交：内积 = 0

<path d="M16 143 H150 M42 160 V31" stroke="currentColor" strokeOpacity=".45" strokeWidth="1"/>
<path d="M42 143 H125" stroke="#238B73" strokeWidth="3" markerEnd="url(#ortharr1)"/>
<path d="M42 143 V48" stroke="#CC8B37" strokeWidth="3" markerEnd="url(#ortharr2)"/>
<rect x="42" y="131" width="12" height="12" fill="none" stroke="currentColor" strokeOpacity=".5"/>

k₁

k₂

</g>
<g>

非正交：内积 ≠ 0

<path d="M175 143 H310 M200 160 V31" stroke="currentColor" strokeOpacity=".45" strokeWidth="1"/>
<path d="M200 143 H290" stroke="#238B73" strokeWidth="3" markerEnd="url(#ortharr1)"/>
<path d="M200 143 L270 72" stroke="#CC8B37" strokeWidth="3" markerEnd="url(#ortharr2)"/>
<path d="M229 143 A29 29 0 0 0 220.5 122.5" stroke="currentColor" fill="none" strokeDasharray="2 2"/>

k₁

k₂

</g>
</svg>

为什么正交对 DeltaNet 很重要？

回顾之前推导的公式：

$$
\Delta(Sk_{\text{old}})
=\beta\delta(k_{\text{new}}^Tk_{\text{old}})
$$

其中 $\delta$ 是新 Token 的预测误差。

如果两个 Key 正交：

$$
k_{\text{new}}^Tk_{\text{old}}=0
$$

那么：

$$
\Delta(Sk_{\text{old}})=0
$$

也就是说，**新 Token 的这次写入不会改变旧 Key 对应的读取结果。**

这正是我们之前说的记忆不干扰。

#### 2. 真实模型中的 Key 会正交吗？

一般不会严格正交。

例如：

$$
k_1=\begin{bmatrix}1\\0\end{bmatrix},
\qquad
k_2=\begin{bmatrix}0.8\\0.6\end{bmatrix}
$$

那么：

$$
k_1^Tk_2=0.8
$$

两个 Key 存在较大的方向重叠，因此第二次写入可能显著影响第一次的记忆。

但在真实模型中，Key 不只有 2 维，而可能是 128 维。

这里出现一个有趣的现象：

**高维空间里的随机向量，往往近似正交。**

例如，在 128 维空间中，两个独立随机单位向量的内积通常接近 0，其标准差约为：

$$
\sigma=\frac1{\sqrt{128}}\approx0.088
$$

不过，语言模型中的 Key 是训练得到的，并不是独立随机向量。它们可能高度相关，因此不能简单认为 128 维就没有记忆干扰。

#### 3. 正交与真实语义有什么关系？

这里要特别小心：

**Key 的内积反映的是模型学习出来的特征空间关系，而不是天然的人类语言语义相似度。**

例如：

- Token A：“苹果”
- Token B：“香蕉”
- Token C：“芯片”

从人类语义上看，苹果和香蕉都属于水果，可能更相近。

但不能据此直接断言：

$$
k_{\text{苹果}}^Tk_{\text{香蕉}}>
k_{\text{苹果}}^Tk_{\text{芯片}}
$$

因为 Key 并不是固定的词义向量。

它由当前 Token 的上下文表示经过学习得到的投影生成，而且不同 Layer、不同 Head 有不同的投影参数。

一个 Head 可能学习实体关系，另一个 Head 可能学习位置或语法关系，也可能学习难以直接解释的特征。

因此，Key 的相似性取决于模型在该 Head 中学到了怎样的表示，而不是我们人为给出的语义类别。

#### 4. 回到 DeltaNet，真正的设计矛盾是什么？

假设一个 Head 的状态矩阵是：

$$
S:[128,128]
$$

它需要持续写入成千上万个 Token 的信息。

但这个 S 的容量始终固定。

当不同 Token 的 Key 存在方向重叠时，写入可能相互干扰。

因此，DeltaNet 必须依赖训练学到的 Key 表示、更新强度和误差修正机制，在有限的状态空间中管理这些信息。

它不保证所有历史信息都能独立、完整地保留下来。

---

我们先停在这里。

我希望确认的是：**两个 Token 的 Key 是否正交，取决于它们在模型学习出的特征空间中的方向关系；即使两个 Token 的自然语言语义相近，也不代表它们的 Key 必然相近。**

这一步理解了吗？

如果理解了，我们下一步进入 **GDN（Gated DeltaNet）**，讨论它为什么还需要增加遗忘门，以及遗忘门是如何影响这个共享状态矩阵的。

## You · 2026-11-20 17:13

妙啊，针对 DeltaNet 这个结构，调整训练方式，目的是使得不同任务生成的key尽可能正交，不能大幅度破坏 状态空间 S。我的理解对吗？

## ChatGPT · 2026-11-20 17:13

**你的理解抓住了 DeltaNet 一个非常重要的设计方向，但需要修正一点：训练的目标并不是让所有 Key 尽可能正交，而是让 Key 的相似性符合模型需要建立的记忆关系。**

我们先只讨论这个区别。

#### 1. 为什么不能简单追求所有 Key 正交？

假设有三个 Token 需要向状态矩阵 S 写入信息：

- Token A：关于用户姓名的信息
- Token B：关于天气的信息
- Token C：更新用户姓名的信息

对于 A 和 B，我们希望它们的 Key 尽可能不干扰：

$$
k_A^Tk_B\approx0
$$

但对于 A 和 C，情况不同。

因为 C 是对 A 的信息进行更新，我们反而可能希望：

$$
k_A^Tk_C\approx1
$$

这样 C 就能定位到 A 曾经写入的记忆方向，利用 Delta Rule 修正它。

<svg viewBox="0 0 320 180" width="100%">
<defs>
<marker id="karrg" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#258D72"/></marker>
<marker id="karrb" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#548FCD"/></marker>
<marker id="karro" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#CA903E"/></marker>
</defs>
<path d="M28 141 H294 M68 158 V20" stroke="currentColor" strokeOpacity=".3" fill="none"/>
<path d="M68 141 L68 34" stroke="#258D72" strokeWidth="3" markerEnd="url(#karrg)"/>
<path d="M68 141 L94 40" stroke="#548FCD" strokeWidth="3" markerEnd="url(#karrb)"/>
<path d="M68 141 H236" stroke="#CA903E" strokeWidth="3" markerEnd="url(#karro)"/>
<path d="M68 129 H80 V141" stroke="currentColor" strokeOpacity=".6" fill="none"/>

kA

kC

kB

A 与 C：方向接近

A 与 B：正交

</svg>

二维示意：相关的信息可以使用接近的 Key，彼此独立的信息可以使用近似正交的 Key。这是一种理想化的记忆组织策略，不代表真实模型一定形成这样的分布。

所以理想目标其实是：

**该共享的记忆允许共享，该覆盖的记忆能够覆盖，不相关的记忆尽量避免相互干扰。**

#### 2. 这是否通过训练实现？

是的，模型可以通过训练逐渐学习这样的 Key 表示。

不过标准 Gated DeltaNet 的核心训练目标通常仍然是语言模型的预测损失，而不是显式地让任意两个 Key 的内积接近零。

训练会联合调整 $W_Q,W_K,W_V$ 以及门控等参数，使最终预测更准确。Key 的组织方式是这种端到端优化的结果。

从研究角度，你提出的方向是有价值的：可以尝试增加 Key 相似性约束，研究是否能够降低状态干扰。但必须避免把所有 Key 无差别地推向正交，否则可能损害信息关联、泛化和记忆覆盖能力。

而且，一个 128 维空间最多只有 128 个两两正交的非零向量，不可能让无限多个不同 Token 的 Key 全部严格正交。

Gated DeltaNet 原论文重点采用的是**可控遗忘和基于 Delta Rule 的定向修正**，而非要求所有 Key 正交。

---

我们先确认这个概念：

**DeltaNet 不只是要减少记忆干扰，还需要让相关信息能够关联和更新。因此，不是所有 Key 越正交越好。**

这与你刚才的设想一致吗？

理解后，我们就可以进入 GDN 最关键的设计：**既然 Key 不可能全部正交，GDN 为什么还需要一个遗忘门 $\alpha$，它与 Delta Rule 分别负责什么？**

## You · 2026-11-20 17:20

我还是没理解 通过 S@k预测 v的目的是什么，k和v没关系啊，这两个是独立的，为什么要设计这样的机制？

## ChatGPT · 2026-11-20 17:21

你这个疑问非常关键。实际上，你已经触及了 DeltaNet 的核心设计：**为什么要强行建立一个 $K\rightarrow V$ 的映射关系？K 和 V 明明是两个不同权重矩阵计算出来的。**

先回答：**K 和 V 不需要天然存在数学上的映射关系。$S k$ 也不是在预测新 Token 的 V，而是在检查当前记忆 S 对这个 K 已经存储了什么。**

我们只讨论这个设计动机。

#### 1. 首先，传统 Attention 其实也建立了 K→V 关联

回顾我们已经理解的 KV Cache：

| Token | Key | Value |
|---|---|---|
| Token 1 | $k_1$ | $v_1$ |
| Token 2 | $k_2$ | $v_2$ |
| Token 3 | $k_3$ | $v_3$ |

传统 Attention 其实做了这样的事情：

- Key：用于找到相关的信息。
- Value：找到之后，实际读取的内容。

例如，当前 Query 与 $k_2$ 很相似，那么 Attention 就会给 $v_2$ 更大的权重。

这里并不要求 $k_2$ 能通过某个预先存在的函数推导出 $v_2$。

**它们的关联来自同一个 Token，而不是 K 和 V 在数学上必须相等或具有某种固定函数关系。**

DeltaNet 延续了这种关联思想，但改变了存储方式。

#### 2. DeltaNet 将 KV Cache 变成了一张可学习的映射表

传统 Attention 显式保存：

$$
(k_1,v_1),(k_2,v_2),\ldots,(k_t,v_t)
$$

DeltaNet 则使用一个矩阵 S 来近似表示这些关联：

$$
\boxed{Sk_i\approx v_i}
$$

注意，这里的意思不是“根据 K 可以天然推导 V”，而是：

**模型希望把 S 调整成：输入一个已经写入过的 K，能够尽可能读出与它关联的 V。**

因此 S 可以理解为一个不断更新的关联记忆（Associative Memory）。

#### 3. 为什么写入之前必须先计算 S@k？

假设当前 S 已经存储了一条关联：

$$
k=1,\qquad v=3
$$

为简化说明，先用一维标量演示。此时：

$$
S=3
$$

因为：

$$
Sk=3\times1=3=v
$$

现在又来了一个具有相同 K 和 V 的 Token。

我们比较两种写入方法。

方法 A：直接累加 V 和 K（普通加性记忆）

$$
S_=S+vk=3+3=6
$$

再次读取：

$$
S_k=6
$$

原本应该读出 3，结果变成了 6。相同信息重复写入，造成了重复累积。

方法 B：Delta Rule（先读取，再修正）

$$
\hat v=Sk=3
$$

$$
\delta=v-\hat v=3-3=0
$$

$$
S_=S+\beta\delta k=3
$$

因为已有记忆能够正确返回 V，所以没有必要再次写入相同信息。

这就是 Delta Rule 的核心动机：

**不是每次 Token 到来都把 V 加进去，而是只写入当前记忆尚未正确表达的部分。**

更进一步，如果同一个 K 对应的 V 从 3 变成 5：

$$
\delta=5-3=2
$$

取 $\beta=1$，状态就从 3 更新为 5。

它因此还具有修正、覆盖已有关联的能力，而不只是累加。

#### 4. 所以 S@k 的真正目的是什么？

$$
\boxed{\delta=v-Sk}
$$

这里的 $Sk$ 是**旧记忆的读取结果**，不是通常意义上的未来预测。

DeltaNet 通过比较目标 V 和旧记忆的输出，决定当前需要写入多少信息。

从数学角度，这相当于针对当前 `(k,v)` 执行一步在线梯度下降，让矩阵 S 的输出更接近 v：

$$
L(S)=\frac12\|Sk-v\|^2
$$

但需要强调：一次更新只是在改善当前关联，不保证所有历史关联都能被同时准确保留。

---

我们先停在这里。

你现在可以把 DeltaNet 的 S 理解成一个**可以持续修改内容的 KV 关联存储器**：

- K 是检索地址（更准确地说是连续的特征地址）。
- V 是希望存储的内容。
- S 是存储这些关联的矩阵。
- $Sk$ 是检查这个地址已经存储了什么。
- $v-Sk$ 是决定要修正多少。

**这样是否解决了你“为什么 K 和 V 要建立映射关系”的疑问？**

如果理解了，下一步我们再讨论一个更深入的问题：**既然普通 Attention 直接保存 KV 就可以准确读取，DeltaNet 为什么要费这么大力气维护 S，以及这样做究竟牺牲了什么？**

## You · 2026-11-20 17:27

理解了

## ChatGPT · 2026-11-20 17:27

接下来是第七步：**既然传统 Attention 直接保存 KV Cache，为什么 DeltaNet 要引入状态矩阵 S？它付出了什么代价？**

核心原因是：**用有限的记忆容量，换取不随上下文长度增长的状态存储和递推计算成本。**

#### 1. 先从 NPU 的计算与存储成本来看

假设一个 Head：

- `head_dim = 128`
- 已经处理 10000 个 Token
- KV Cache 使用 FP16
- DeltaNet 状态矩阵 S 使用 FP32

传统 Attention

$$
K,V:[10000,128]
$$

每个 Head 的 KV Cache

**4.88 MiB**

随 Token 数量线性增长

DeltaNet

$$
S:[128,128]
$$

每个 Head 的递推状态

**64 KiB**

与 Token 数量无关

传统 Attention 在 Decode 时，需要遍历历史 K、V，完成匹配和加权求和。

DeltaNet 不需要遍历所有历史 Token，而是使用固定的 S 完成读取和更新。

因此，对于一个 Head：

| 比较项 | 传统 Attention | DeltaNet |
|---|---|---|
| 历史存储 | $O(Td)$ | $O(d^2)$ |
| 单 Token 核心计算 | $O(Td)$ | $O(d^2)$ |
| 历史 Token 增加 | 访存和计算增加 | 状态规模不变 |
| 历史信息 | 逐 Token 保留 K/V | 融合到共享 S 中 |

其中 $T$ 是历史长度，$d$ 是 Head 维度。

注意，DeltaNet 不是任何时候都更快。当历史序列很短时，更新整个 S 的成本可能反而更高。

#### 2. DeltaNet 牺牲了什么？

最重要的是：**无法像 KV Cache 一样，完整保留每个 Token 原始的 K、V。**

假设传统 Attention 保存了：

$$
(k_1,v_1),(k_2,v_2),\ldots,(k_{10000},v_{10000})
$$

这些向量仍然可以被分别访问。虽然 Softmax Attention 的输出通常是多个 V 的加权和，但原始缓存本身没有因为后续 Token 的到来而被覆盖。

而 DeltaNet 只有：

$$
S:[128,128]
$$

10000 个 Token 的信息都通过递推更新融合进这个矩阵。

这意味着：

- 新信息可能覆盖旧信息。
- 不同 Key 之间可能产生记忆干扰。
- 不保证能够恢复每个历史 Token 的原始 V。
- 历史信息能保留多少，取决于学习到的特征表示与更新机制。

因此，**DeltaNet 的 S 不是 KV Cache 的无损压缩。**

#### 3. 这也是为什么混合架构值得研究

回到最开始的 Qwen3.5-0.8B：18 个 GDN 层搭配 6 个标准 Attention 层。

可以从架构设计角度理解这种组合的动机：

GDN 提供固定容量的递推记忆，降低长上下文处理的存储与计算增长；标准 Attention 则保留直接访问历史 Token 的能力。

但不能简单断言 GDN 负责短期记忆、Attention 负责长期记忆。具体功能分工是训练后形成的，需要实验验证。

---

这里先停下来，确认一个关键认识：

**传统 Attention 更像保存所有历史记录，需要时重新检索；DeltaNet 更像维护一份不断更新的摘要状态，读取效率不再随历史长度增长，但无法保证保留全部历史细节。**

你是否理解了这个取舍？

确认之后，我们再进入 GDN 最核心的机制：**既然 S 的容量有限，GDN 如何通过遗忘门控制哪些信息被保留、哪些信息被遗忘？**

## You · 2026-11-20 17:35

同意

## ChatGPT · 2026-11-20 17:36

接下来进入第八步：**GDN（Gated DeltaNet）相比 DeltaNet，究竟增加了什么？**

我们先只理解一个概念：**遗忘门（Forgetting Gate），也就是 $\alpha$。**

#### 1. 为什么 DeltaNet 还需要遗忘门？

回顾普通 DeltaNet：

$$
S_t=S_{t-1}+\beta_t(v_t-S_{t-1}k_t)k_t^T
$$

我们之前发现一个问题：

如果一个 Key 对应的信息已经没有用了，但后续 Token 的 Key 始终与它正交，那么这部分旧记忆就可能一直保留在 S 中。

Delta Rule 能够沿当前 Key 的方向修正记忆，但**不能保证不再访问的旧记忆被清除**。

所以 GDN 引入一个新机制：在写入新信息之前，先让旧状态适当衰减。

#### 2. 遗忘门如何工作？

先不考虑 K、V 的写入，只看遗忘操作：

$$
\boxed{\bar S_t=\alpha_tS_{t-1}}
$$

其中：

$$
0<\alpha_t<1
$$

假设状态矩阵：

$$
S_{t-1}=
\begin{bmatrix}
2&4\\
6&8
\end{bmatrix}
$$

下面可以调整 $\alpha$，观察 S 如何变化。

**遗忘门 α**

- 旧状态 S
- 衰减后 S

尝试把 α 调到 0.2、0.8、1.0，观察状态矩阵如何变化。这里用 0 和 1 展示理论极限。

这个机制很直接：

- $\alpha$ 接近 1：大部分旧记忆被保留。
- $\alpha$ 接近 0：旧记忆被大幅衰减。
- $\alpha=1$：不执行遗忘，退化为普通 DeltaNet 的更新机制。

#### 3. 那么 α 由谁决定？

**不是程序员手动设置，而是模型根据当前 Token 的特征，通过训练得到的门控参数计算出来的。**

例如，同一个 Head 处理不同 Token 时，可能产生：

$$
\alpha_1=0.99,\quad
\alpha_2=0.95,\quad
\alpha_3=0.30
$$

这表示不同时刻的旧状态保留程度不同。

但有个非常重要的限制：

**基本 GDN 的 $\alpha_t$ 通常是每个 Head、每个 Token 对应的一个标量，它对该 Head 整个 S 进行缩放，而不是精准删除某个历史 Token 的记忆。** 

因此，它更像控制整个状态的保留程度，而不是一个可以按地址删除记录的缓存管理器。

---

最后把 GDN 的完整状态更新公式放在这里，暂时不需要重新推导：

$$
\boxed{
S_t=\alpha_tS_{t-1}
+\beta_t(v_t-\alpha_tS_{t-1}k_t)k_t^T
}
$$

相比普通 DeltaNet，唯一新增的关键机制就是 $\alpha_t$ 对旧状态的衰减。

**现在确认一下：**

遗忘门 $\alpha$ 并不是从 S 中选择某个 Token 删除，而是在每次状态更新时，控制旧状态整体保留多少。

这一点理解了吗？

确认后，我们再讨论一个值得深入的问题：**既然 α 会使整个 S 衰减，会不会把原本重要的历史信息也一起破坏？GDN 如何处理这个问题？**

## You · 2026-11-20 17:54

好了，现在梳理一下 GDN和DeltaNet是不是都讲完了，还有遗漏吗？

## ChatGPT · 2026-11-20 17:55

**还没有全部讲完。DeltaNet 的核心原理已经基本讲清楚了，但 GDN（Gated DeltaNet）目前只讲了遗忘门 $\alpha$，距离完整理解其算法和 NPU 硬件执行流程还有几个关键环节。**

我把之前的讨论整理为一份知识进度表，区分已经理解的内容、尚未讨论的内容，以及与 Qwen3.5-0.8B 相关的实现细节。

#### 一、已经完成的知识

| 知识点 | 状态 |
|---|---|
| Head 是什么，多个 Head 如何划分 |  已讲 |
| Q、K、V 的生成与作用 |  已讲 |
| 传统 Attention 的计算与 KV Cache |  已讲 |
| DeltaNet 为什么使用固定状态矩阵 S |  已讲 |
| $S k$ 为什么用于读取已有记忆 |  已讲 |
| Delta Rule：误差修正与外积更新 |  已讲 |
| Key 正交与记忆干扰 |  已讲 |
| DeltaNet 与 Attention 的存储、计算取舍 |  已讲 |
| GDN 遗忘门 $\alpha$ 的基本作用 |  初步讲解 |

到目前为止，已经可以理解 DeltaNet 最核心的递推关系：

$$
S_t=S_{t-1}+\beta_t(v_t-S_{t-1}k_t)k_t^T
$$

也理解了 GDN 为什么要进一步控制旧状态的保留程度。

#### 二、还没有讲完的关键内容

我核对了 Qwen3.5-0.8B 的官方配置与 Transformers 实现。接下来还有六部分值得讨论。

| 顺序 | 待讲内容 | 重要程度 |
|---|---|---|
| 1 | **GDN 的完整门控机制**：$\alpha$ 与 $\beta$ 分别如何控制遗忘、修正和写入 | 核心 |
| 2 | **一个 Token 的完整执行过程**：从输入 X 到 Q/K/V、更新 S、产生输出 | 核心 |
| 3 | **Qwen3.5 的实际 GDN 结构**：短卷积、SiLU、Q/K 归一化、输出门控、RMSNorm | 核心 |
| 4 | **Prefill 与 Decode 的区别**：为什么 Decode 逐 Token 递推，Prefill 却可以采用 Chunkwise 并行计算 | 核心 |
| 5 | **GDN 的 NPU 硬件映射**：GEMV、外积、VMEM 布局、读写带宽和计算依赖 | 架构重点 |
| 6 | **性能与模型能力边界**：状态容量、长上下文记忆、混合 Attention 的作用 | 进阶 |

这里特别补充两个此前没有深入讨论的事实。

**第一，Qwen3.5 的 GDN 不只是 Delta Rule 加一个 $\alpha$。**

实际实现还包括一个短卷积（卷积核长度为 4）、Q/K 归一化、写入强度 $\beta$、输出归一化和门控。我们目前理解的只是核心递推算法，还不是完整的模型层。

**第二，Prefill 和 Decode 的执行方式差异非常重要。**

在 Decode 中，可以逐 Token 更新 S；但 Prefill 若完全串行执行递推，会限制并行度。因此 GDN 还设计了 Chunkwise 算法，将多个 Token 的计算转换为更适合 GPU/NPU 的矩阵运算。

#### 三、回到最开始的 Qwen3.5-0.8B

官方配置已经确认：

Qwen3.5-0.8B · 语言模型主干

- 总层数 · **24**
- GDN 层 · **18**
- Attention 层 · **6**

6 ×（GDN、GDN、GDN、Attention）

每个 GDN 层：16 Heads × 128 × 128 × FP32 = **1 MiB 状态矩阵**。

18 个 GDN 层：总计 **18 MiB** 递推矩阵状态（Batch=1，不包括卷积状态和其他缓存）。

来源：[Qwen 官方模型配置](https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/config.json)

需要强调，前面讲解时采用的 $S[v,k]$ 与部分源码中的 $S[k,v]$ 互为转置，不应把二者混为一谈。后续讨论 NPU 内存布局时，我们会明确采用哪一种约定。

#### 四、建议下一步

按照之前的渐进式学习方式，我建议先完成 **GDN 的门控机制**，然后再进入完整计算流程与硬件映射。

下一步只解决一个问题：

**GDN 中已经有遗忘门 $\alpha$，为什么还需要写入门 $\beta$？两者到底有什么本质区别？**

这一步结束后，才能把 DeltaNet 和 GDN 的完整计算逻辑真正串联起来。

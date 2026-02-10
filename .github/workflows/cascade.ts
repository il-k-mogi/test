import type * as core from '@actions/core'
import type * as github from '@actions/github'

type Args = {
  github: ReturnType<typeof github.getOctokit>
  context: typeof github.context
  core: typeof core
  currentBranch: string
  originalPrNumber: number
}

/**
 * セマンティックバージョンでソートするための比較関数
 * release/v1.0.0 形式を想定
 */
const compareVersions = (a: string, b: string): number => {
  const versionA = a.replace('release/v', '').split('.').map(Number)
  const versionB = b.replace('release/v', '').split('.').map(Number)

  for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
    const numA = versionA[i] ?? 0
    const numB = versionB[i] ?? 0
    if (numA !== numB) return numA - numB
  }
  return 0
}

const main = async ({ github, context, core, currentBranch, originalPrNumber }: Args) => {
  const { owner, repo } = context.repo

  const { data: allBranches } = await github.rest.repos.listBranches({
    owner,
    repo,
    per_page: 100,
  })

  const releaseBranches = allBranches
    .map(b => b.name)
    .filter(name => name.startsWith('release/v'))
    .sort(compareVersions)

  core.info(`リリースブランチ一覧: ${releaseBranches.join(', ')}`)

  const currentIndex = releaseBranches.findIndex(branch => branch === currentBranch)
  const targetBranches = currentIndex >= 0 ? releaseBranches.slice(currentIndex + 1) : []

  if (targetBranches.length === 0) {
    core.info('次期リリースブランチが見つかりませんでした。')
    return
  }

  core.info(`カスケードマージ対象ブランチ: ${targetBranches.join(', ')}`)

  const cascadeMerge = async (headBranch: string, baseBranch: string): Promise<void> => {
    const { data: existingPrs } = await github.rest.pulls.list({
      owner,
      repo,
      base: baseBranch,
      head: `${owner}:${headBranch}`,
      state: 'open',
    })

    if (existingPrs.length > 0) {
      core.info(`PR が既に存在します: ${existingPrs[0].html_url}`)
      throw new Error('PR already exists')
    }

    core.info(`PR を作成します: ${headBranch} -> ${baseBranch}`)

    const { data: newPr } = await github.rest.pulls.create({
      owner,
      repo,
      base: baseBranch,
      head: headBranch,
      title: `Cascade Merge: ${headBranch} -> ${baseBranch}`,
      body: `This is an automated cascade merge PR triggered by a push to ${headBranch}.`,
    })

    try {
      await github.rest.pulls.merge({
        owner,
        repo,
        pull_number: newPr.number,
        merge_method: 'merge',
      })

      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: originalPrNumber,
        body: `✅ ${baseBranch} へのカスケードマージに成功しました。 #${newPr.number}`,
      })
    } catch (error) {
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: originalPrNumber,
        body: `❌ ${baseBranch} への自動マージに失敗しました。手動でマージしてください。 #${newPr.number}`,
      })
      throw error
    }
  }

  await targetBranches.reduce(
    (promise, baseBranch) =>
      promise.then(headBranch => cascadeMerge(headBranch, baseBranch).then(() => baseBranch)),
    Promise.resolve(currentBranch),
  )

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: originalPrNumber,
    body: '✅ カスケードマージが完了しました。',
  })
}

export { main }

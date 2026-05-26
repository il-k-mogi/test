import type * as core from '@actions/core';
import type * as github from '@actions/github';

type Args = {
  github: ReturnType<typeof github.getOctokit>;
  context: typeof github.context;
  core: typeof core;
};

const main = async ({ github, context, core }: Args): Promise<void> => {
  const { owner, repo } = context.repo;
  const pr = context.payload.pull_request;

  if (!pr) {
    core.setFailed('pull_request ペイロードが見つかりません');
    return;
  }

  const baseBranch: string = pr.base.ref;
  const match = baseBranch.match(/^release\/(v.+)$/);

  if (!match) {
    core.info(`ベースブランチ '${baseBranch}' はリリースブランチではありません。スキップします。`);
    return;
  }

  const version = match[1];
  core.info(`対象バージョン: ${version}`);

  const milestones = await github.paginate(github.rest.issues.listMilestones, {
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });

  const milestone = milestones.find((m) => m.title === version);

  if (!milestone) {
    core.warning(`マイルストーン '${version}' が見つかりません。スキップします。`);
    return;
  }

  const { data: issue } = await github.rest.issues.get({
    owner,
    repo,
    issue_number: pr.number,
  });

  if (issue.milestone?.number === milestone.number) {
    core.info(`マイルストーン '${version}' はすでに設定されています。`);
    return;
  }

  await github.rest.issues.update({
    owner,
    repo,
    issue_number: pr.number,
    milestone: milestone.number,
  });

  core.info(`✅ マイルストーン '${version}' を PR #${pr.number} に設定しました。`);
};

export { main };

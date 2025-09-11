function checkIsMaintainer(comment) {
  const isMaintainer = ['MEMBER', 'OWNER'].includes(comment.author_association);

  console.log(`Slash command from: ${comment.user.login} (${comment.author_association}) : ${isMaintainer ? '✅ Maintainer' : '❌ Not Maintainer'}`);

  return isMaintainer;
}

async function handlePullRequest({ context, github }) {
  const pr = context.payload.pull_request;
  const isFork = pr.head.repo.full_name !== pr.base.repo.full_name;

  console.log("handlePullRequest triggered");

  console.log(`PR #${pr.number}: ${pr.head.repo.full_name} -> ${pr.base.repo.full_name} <---> Is fork: ${isFork}, SHA: ${pr.head.sha}`);

  if (!isFork) {
    console.log('Internal PR - running tests automatically');
    return true;
  }

  const comments = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pr.number
  });

  console.log("Comments:")
  console.log(JSON.stringify(comments));

  const comment = comments.data.find(comment => {
    const hasApprovalMarker = comment.body.includes(`APPROVAL_MARKER:${pr.head.sha}`);
    const isMaintainer = checkIsMaintainer(comment);
    return hasApprovalMarker && isMaintainer;
  });

  console.log("Comment:")
  console.log(comment);

  return comment != null;
}

async function handleIssueComment({ context, github }) {
  if (!context.payload.issue.pull_request) return false;
  if (!context.payload.comment.body.includes('/allow')) return false;

  const sleepDuration = (parseInt(process.env.GITHUB_RUN_ID.slice(-2)) % 10) * 1000;
  console.log(`Sleeping for ${Math.round(sleepDuration)}ms to simulate processing delay...`);
  await new Promise(resolve => setTimeout(resolve, sleepDuration));

  /*
  Possible `author_association` values;
    "OWNER" – repository owner
    "MEMBER" – member of the org that owns the repo
    "COLLABORATOR" – user with write access to the repo
    "CONTRIBUTOR" – user who has contributed in the past
    "NONE" – random user, no relationship
  */
  const authorAssociation = context.payload.comment.author_association;
  const commenter = context.payload.comment.user.login;
  const isMaintainer = checkIsMaintainer(context.payload.comment);

  if (!isMaintainer) {
    const comments = await github.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.issue.number
    });

    const rejectionMessage = `@${commenter} - Sorry, only maintainers can approve tests on fork PRs. Required: MEMBER or OWNER. Current: ${authorAssociation}`;

    const existingRejection = comments.data.find(comment => comment.body.includes(rejectionMessage));

    if (!existingRejection) {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.issue.number,
        body: rejectionMessage
      });
    }
    return false;
  }

  const pr = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.issue.number
  });

  const isFork = pr.data.head.repo.full_name !== pr.data.base.repo.full_name;

  console.log(`PR #${pr.data.number}: ${pr.data.head.repo.full_name} -> ${pr.data.base.repo.full_name} <---> Is fork: ${isFork}, SHA: ${pr.data.head.sha}`);

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.issue.number,
    body: [
      '## ✅ Test Approved',
      '',
      `@${commenter} has approved running terraform tests for commit \`${pr.data.head.sha}\`.`,
      '',
      '**Approval Details:**',
      `- Commit SHA: \`${pr.data.head.sha}\``,
      `- Approved by: @${commenter}`,
      `- Approved at: ${new Date().toISOString()}`,
      '',
      '**Important:** If new commits are pushed, tests will need to be re-approved.',
      '',
      `<!-- APPROVAL_MARKER:${pr.data.head.sha} -->`
    ].join('\n')
  });

  return true;
}

export default async function checkForkAndApproval({ context, github, core }) {
  let should_run = false;

  console.log("event: " + context.eventName);
  if (context.eventName === 'schedule' || context.eventName === 'workflow_dispatch') {
    should_run = true;
  }

  if (context.eventName === 'merge_group' || context.eventName === 'pull_request') {
    should_run = await handlePullRequest({ context, github, core });
  }

  if (context.eventName === 'issue_comment') {
    should_run = await handleIssueComment({ context, github, core });
  }

  console.log(`Should run tests: ${should_run ? '✅ Yes' : '❌ No'}`);

  core.setOutput('should_run', should_run.toString());
}

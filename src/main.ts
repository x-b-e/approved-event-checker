import * as core from "@actions/core";
import Octokit from "@octokit/rest";
import * as fs from "fs";
import { flatten, map } from "streaming-iterables";
import * as util from "util";
const readFile = util.promisify(fs.readFile);

// tslint:disable: no-unsafe-any
async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const nwo = process.env.GITHUB_REPOSITORY;
    const path = process.env.GITHUB_EVENT_PATH;
    if (!token || !nwo || !path) {
      core.setFailed("GITHUB_TOKEN or GITHUB_REPOSITORY doesn't set");
      return;
    }
    const payload = JSON.parse(await readFile(path, { encoding: "utf-8" }));
    const action = payload.action;
    if (!payload.review) {
      await getApprovedUsers(token, nwo, payload.pull_request.number);
      return;
    }
    const state = payload.review.state;
    if (!payload.pull_request) {
      core.setFailed("this event doesn't contain pull request");
      return;
    }
    if (action === "submitted" && state === "approved") {
      await getApprovedUsers(token, nwo, payload.pull_request.number);
    } else {
      core.info(
        `${process.env.GITHUB_EVENT_NAME}/${action}/${state} is not suitable for check.`
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }

  async function getApprovedUsers(
    token: string,
    nwo: string,
    pull_number: number
  ) {
    const approvals = core.getInput("approvals");
    const checkRequested = getCheckChangesRequested();
    const octokit = new Octokit({ auth: `token ${token}` });
    const [owner, repo] = nwo.split("/");
    const options = octokit.pulls.listReviews.endpoint.merge({
      owner,
      repo,
      pull_number
    });
    const list = map(
      (response: Octokit.Response<Octokit.PullsListReviewsResponse>) =>
        response.data,
      octokit.paginate.iterator(options)
    );

    const users = new Set<string>();
    for await (const review of flatten(list)) {
      if (review.state === "APPROVED") {
        users.add(review.user.login);
        console.log(`approved by ${review.user.login}`);
      } else if (checkRequested && review.state === "CHANGES_REQUESTED") {
        console.log(`changes requested by ${review.user.login}`);
        core.setOutput("approved", false);
        break;
      }
    }
    let approved = true;
    let approvalsNeededFrom = approvals.split(",");
    console.log(`approvalsNeededFrom: ${approvalsNeededFrom}`);
    console.log(`users: ${Array.from(users)}`);

    for (const approvalNeededFromUser of approvalsNeededFrom) {
      if (!users.has(approvalNeededFromUser)) {
        approved = false;
        break;
      }
    }

    core.setOutput("approved", approved);
  }
}

function getCheckChangesRequested() {
  const b = core.getInput("check_changes_requested");
  return b === undefined || b === "true";
}

// tslint:disable-next-line: no-floating-promises
run();

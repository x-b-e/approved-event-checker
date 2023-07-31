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
    const state =
      payload.review && payload.review.state ? payload.review.state : undefined;
    if (!payload.pull_request) {
      core.setFailed("this event doesn't contain pull request");
      return;
    }
    if (action === "submitted" && state === "approved") {
      const approvals = getApprovals();
      const checkRequested = getCheckChangesRequested();
      const octokit = new Octokit({ auth: `token ${token}` });
      const [owner, repo] = nwo.split("/");
      const options = octokit.pulls.listReviews.endpoint.merge({
        owner,
        repo,
        pull_number: payload.pull_request.number
      });
      const list = map(
        (response: Octokit.Response<Octokit.PullsListReviewsResponse>) =>
          response.data,
        octokit.paginate.iterator(options)
      );

      const users = new Set<string>();
      for await (const review of flatten(list)) {
        if (review && review.state === "APPROVED") {
          users.add(review.user.login);
        } else if (
          checkRequested &&
          review &&
          review.state === "CHANGES_REQUESTED"
        ) {
          core.setOutput("approved", false);
        }
      }

      core.setOutput("approved", approvals <= users.size);
    } else {
      core.info(
        `${process.env.GITHUB_EVENT_NAME}/${action}/${state} is not suitable for check.`
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

function getApprovals() {
  const n = core.getInput("approvals");
  if (/\d{1,2}/.test(n)) {
    const i = Number.parseInt(n, 10);
    if (0 < i) {
      return i;
    }
  }
  return 1;
}

function getCheckChangesRequested() {
  const b = core.getInput("check_changes_requested");
  return b === undefined || b === "true";
}

// tslint:disable-next-line: no-floating-promises
run();

import { CerberusError, ErrorCode } from "../core/errors.js";
import {
  formatDoctorCheckJson,
  runDoctorCheck,
  runDoctorCleanup,
} from "../services/doctor-service.js";
import type { AppContext } from "../core/types.js";

function parseDoctorArgs(args: string[]): {
  subcommand: string;
  json: boolean;
  apply: boolean;
  dryRunExplicit: boolean;
} {
  if (args.length === 0) {
    throw new CerberusError(
      "Usage: cerberus doctor <check|cleanup> ...",
      ErrorCode.INVALID_ARGS,
    );
  }

  const subcommand = args[0];
  let json = false;
  let apply = false;
  let dryRunExplicit = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--apply") {
      apply = true;
    } else if (args[i] === "--dry-run") {
      dryRunExplicit = true;
    } else if (args[i]?.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for doctor ${subcommand}: ${args[i]}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  }

  return { subcommand, json, apply, dryRunExplicit };
}

export async function runDoctorCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { subcommand, json, apply, dryRunExplicit } = parseDoctorArgs(args);

  if (subcommand === "check") {
    const result = await runDoctorCheck(context.paths);
    if (json) {
      console.log(formatDoctorCheckJson(result));
    } else if (result.ok) {
      console.log("No consistency issues found.");
    } else {
      for (const issue of result.issues) {
        const loc = issue.path ? ` (${issue.path})` : "";
        console.log(`[${issue.kind}] ${issue.detail}${loc}`);
      }
    }
    return;
  }

  if (subcommand === "cleanup") {
    if (apply && dryRunExplicit) {
      throw new CerberusError(
        "Specify only one of --apply or --dry-run.",
        ErrorCode.INVALID_ARGS,
      );
    }

    const doApply = apply && !dryRunExplicit;
    const { plan, applied } = await runDoctorCleanup(context.paths, {
      apply: doApply,
    });

    if (plan.items.length === 0) {
      if (json) {
        const output = {
          version: 1,
          applied: applied && doApply,
          dryRun: !doApply,
          totalActions: 0,
          actions: [],
          summary: "No cleanup actions apply to this vault.",
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      console.log("No cleanup actions apply to this vault.");
      return;
    }

    const actions = plan.items.map((item) => ({
      action: item.action,
      detail: item.detail,
      target: item.target,
    }));

    if (json) {
      const output = {
        version: 1,
        applied: applied && doApply,
        dryRun: !doApply,
        totalActions: plan.items.length,
        actions: actions,
        summary: doApply
          ? `Cleanup applied: ${plan.items.length} action(s)`
          : `Cleanup planned: ${plan.items.length} action(s) (dry-run, no changes)`,
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(
      doApply
        ? `Applying ${plan.items.length} cleanup action(s):`
        : `Planned ${plan.items.length} cleanup action(s) (dry-run, no changes):`,
    );
    for (const item of plan.items) {
      console.log(`  - ${item.action}: ${item.target}`);
    }
    if (applied && doApply) {
      console.log("Cleanup applied.");
    } else if (!doApply) {
      console.log("Run with --apply to perform these actions.");
    }
    return;
  }

  throw new CerberusError(
    `Unknown doctor subcommand: ${subcommand}`,
    ErrorCode.INVALID_ARGS,
  );
}

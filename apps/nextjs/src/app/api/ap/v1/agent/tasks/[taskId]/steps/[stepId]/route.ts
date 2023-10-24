import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { appRouter } from "@acme/api";
import { authOptions } from "@acme/auth";
import { prisma } from "@acme/db";

// GET /ap/v1/agent/tasks/:taskId/steps/:stepId
export async function GET(
  req: NextRequest,
  {
    params: { taskId, stepId },
  }: { params: { taskId: string; stepId: string } },
) {
  if (!taskId) {
    return NextResponse.json(
      { message: "Unable to find entity with the provided id" },
      { status: 404 },
    );
  }

  const session = await getServerSession(authOptions);

  const caller = appRouter.createCaller({
    session: session || null,
    prisma,
    origin: req.nextUrl.origin,
  });
  const goal = await caller.goal.byId(taskId);
  if (!goal?.executions[0]?.id) {
    return NextResponse.json(
      { message: "Unable to find entity with the provided id" },
      { status: 404 },
    );
  }
  const taskSteps = goal.executions[0].graph?.nodes || [];

  const step = taskSteps.find((step) => step.id === stepId);

  return Response.json(step, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

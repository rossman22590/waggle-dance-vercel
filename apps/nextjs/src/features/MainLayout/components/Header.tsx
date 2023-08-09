import React, { useMemo } from "react";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { MoreVert } from "@mui/icons-material";
import {
  Avatar,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import { useSession } from "next-auth/react";

import { app } from "~/constants";
import useGoalStore from "~/stores/goalStore";
import ThemeToggle from "./ThemeToggle";

const Header = ({}) => {
  const router = useRouter();
  const { slug } = router.query;
  const { data: session } = useSession();
  const { selectedGoal } = useGoalStore();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const isOpen = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isOpen) {
      event.preventDefault();
      setAnchorEl(null);
      return;
    }

    setAnchorEl(event.currentTarget);
  };
  const cleanedSlug = useMemo(() => {
    if (typeof slug === "string") {
      return slug;
    } else if (Array.isArray(slug)) {
      return slug[0];
    } else {
      return slug;
    }
    return "";
  }, [slug]) as string;

  const activeIndex = useMemo(() => {
    if (cleanedSlug === "" || cleanedSlug === "/") {
      return 0;
    }
    if (
      (selectedGoal?.executions.length ?? 0) === 0 &&
      (selectedGoal?.userId ?? "") === ""
    ) {
      return 0;
    } else {
      return 1;
    }
    // return Object.keys(routes).findIndex((path) => path === slug);
  }, [cleanedSlug, selectedGoal]);

  const isHomeSlug = activeIndex === 0;

  return (
    <header className="z-10 mx-auto w-full px-5 pb-2 pt-0">
      <Stack
        direction="row"
        sx={{ paddingTop: { xs: 1, sm: 3 }, paddingBottom: { xs: 1, sm: 3 } }}
      >
        <Typography
          className="flex-grow"
          fontSize={{ xs: "15pt", sm: "24pt" }}
          level={isHomeSlug ? "h3" : "h4"}
        >
          waggle🐝<Typography>💃dance</Typography>
          <Typography level="body-xs" className="pl-2">
            {app.version}
          </Typography>
        </Typography>
        <IconButton
          id="menu-button"
          aria-controls={isOpen ? "main-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={isOpen ? "true" : undefined}
          variant="outlined"
          color="neutral"
          onClick={handleOpen}
        >
          <MoreVert />
        </IconButton>
        <Menu
          id="main-menu"
          variant="outlined"
          anchorEl={anchorEl}
          open={isOpen}
          aria-labelledby="menu-button"
        >
          <MenuItem orientation="vertical">
            <ThemeToggle />
          </MenuItem>
          <MenuItem orientation="vertical">
            {session?.user ? (
              <Tooltip title={`You are signed in as ${session.user.name}`}>
                <Link>
                  <span onClick={handleOpen}>
                    <Avatar
                      className="mr-3"
                      src={session.user.image || undefined}
                      alt={session.user.name || undefined}
                    />
                  </span>
                </Link>
              </Tooltip>
            ) : (
              <Typography className="p-2">
                <NextLink href="/api/auth/signin">Sign in/up</NextLink>
              </Typography>
            )}
          </MenuItem>
        </Menu>
      </Stack>
    </header>
  );
};

export default Header;

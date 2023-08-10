// features/MainLayout/index.tsx

import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  Box,
  Card,
  GlobalStyles,
  LinearProgress,
  Sheet,
  useColorScheme,
} from "@mui/joy";

import { app } from "~/constants";
import useApp from "~/stores/appStore";
import GoalTabs from "../WaggleDance/components/GoalTabs";
import Alerts from "./components/Alerts";
import Footer from "./components/Footer";
import Header from "./components/Header";

type Props = {
  children: React.ReactNode;
};

const MainLayout = ({ children }: Props) => {
  const { mode } = useColorScheme();
  const { isPageLoading } = useApp();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // necessary for server-side renderingπ
  // because mode is undefined on the server
  useEffect(() => {
    setMounted(true);
  }, [router]);

  const progressOpacity = useMemo(() => {
    return isPageLoading ? 100 : 0;
  }, [isPageLoading]);

  const pageOpacity = useMemo(() => {
    return isPageLoading ? 50 : 100;
  }, [isPageLoading]);

  if (!mounted) {
    return null;
  }
  return (
    <Box
      className={`bg-honeycomb xs:pt-0 sm:pt-2 ${
        mode === "dark" ? " dark" : "light"
      }`}
    >
      <Box
        className={`h-screen overflow-x-clip overflow-y-scroll px-2 pb-2 ${
          mode === "dark" ? " dark" : "light"
        }`}
        sx={{
          minHeight: "calc(100dvh + env(safe-area-inset-bottom))",
        }}
      >
        <Head>
          <title>{app.name}</title>
          <meta name="description" content={app.description} />
          <meta
            name="theme-color"
            content={mode === "dark" ? "#2e1900" : "#FAB561"}
          />
          <meta
            name="viewport"
            content="initial-scale=1, viewport-fit=cover width=device-width height=device-height"
          />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content={app.name} />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content={mode === "dark" ? "black-translucent" : "default"}
          />
          <link rel="manifest" href="/manifest.json" />
        </Head>

        <GlobalStyles
          styles={(_theme) => ({
            ":root": {
              "--Header-height": "2.8rem",
            },
          })}
        />
        <Sheet
          className="sticky mx-auto md:max-w-screen-lg xl:max-w-screen-lg"
          sx={{
            borderRadius: "lg",
            shadowRadius: "xl",
            zIndex: 101,
          }}
          variant="soft"
        >
          <Header />
          <Card
            invertedColors
            color="primary"
            variant="outlined"
            className="-m-2 p-0"
            sx={{
              borderRadius: "lg",
              paddingBottom: 0,
              opacity: pageOpacity,
            }}
          >
            <Alerts />
            <GoalTabs>
              <LinearProgress
                thickness={3}
                sx={{ opacity: progressOpacity }}
                color="neutral"
              />
              {children}
            </GoalTabs>
          </Card>
          <Footer className="xs:scale-75 sticky bottom-0 flex w-full pb-2 pt-10 md:scale-100" />
        </Sheet>
      </Box>
    </Box>
  );
};

export default MainLayout;

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationService } from "../../services/notification/notificationService";
import { useEffect } from "react";

export function useNotifications() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.getNotifications(),
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }, 30000);
    return () => clearInterval(interval);
  }, [queryClient]);

  return query;
}
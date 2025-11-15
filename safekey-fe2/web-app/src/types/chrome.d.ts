declare namespace chrome {
  namespace runtime {
    const id: string | undefined
    const lastError: { message: string } | undefined
    function sendMessage(
      extensionId: string,
      message: any,
      responseCallback?: (response: any) => void
    ): void
  }
}


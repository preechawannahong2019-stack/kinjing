declare module 'promptpay-qr' {
    /** สร้าง EMVCo payload ของ PromptPay จากเบอร์มือถือ/เลขบัตรประชาชน/e-Wallet ID */
    function generatePayload(target: string, options?: { amount?: number }): string;
    export default generatePayload;
}

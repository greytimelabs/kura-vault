import { llmsFullTxt } from '../data/llms';

export const GET = () => new Response(llmsFullTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

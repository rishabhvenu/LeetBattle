declare module '@koa/cors' {
  import { Middleware } from 'koa';
  function cors(options?: any): Middleware;
  export default cors;
}

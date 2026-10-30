import {Component, type ReactNode} from 'react';

/** Keep navigation and saved project data accessible when a route chunk fails. */
export class RouteLoadBoundary extends Component<{children:ReactNode}, {error:Error|null}> {
  state:{error:Error|null}={error:null};
  static getDerivedStateFromError(error:Error){return {error};}
  render(){
    if(!this.state.error)return this.props.children;
    const missingModule=/dynamically imported module|Loading chunk|Importing a module script|module script failed/i.test(this.state.error.message);
    return <section className="studio-loading" role="alert">
      <h2>{missingModule?'编辑器代码需要重新载入':'工作台未能正常显示'}</h2>
      <p>{missingModule?'软件更新后，当前窗口的代码可能已过期。重新载入即可再次打开当前工程。':'请重新载入当前页面；如果仍无法打开，请提供工程诊断信息。'}</p>
      <button type="button" onClick={()=>window.location.reload()}>重新载入当前工程</button>
    </section>;
  }
}

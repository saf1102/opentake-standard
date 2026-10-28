import {UpdateReminder} from '../standard/ClientUpdate';
import type {ReactNode} from 'react';import {UpgradeButton} from '../standard/Upgrade';
export function DesktopSession({children}:{children:ReactNode}){return <>{children}</>}
export const DesktopActions=()=> <><UpdateReminder/><UpgradeButton/></>;
export function DesktopSettings(_props:{section:string}){return null}

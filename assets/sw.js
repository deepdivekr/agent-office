// Agent Office service worker: shows the push notifications Office sends and opens the feed when one is tapped.
// It does not intercept requests or cache pages.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data?event.data.json():{};}catch{data={};}
  event.waitUntil(self.registration.showNotification(data.title||'Agent Office',{body:data.body||'',tag:data.tag||undefined,icon:'icon-180.png',badge:'icon-180.png',data:{view:data.view||''}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(self.registration.scope);if(event.notification.data&&event.notification.data.view)url.searchParams.set('view',event.notification.data.view);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list)if(client.url.startsWith(self.registration.scope)&&'focus' in client)return client.focus().then(c=>c.navigate?c.navigate(url.href):c);
    return self.clients.openWindow(url.href);
  }));
});

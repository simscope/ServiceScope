const fs = require('fs');
const path = require('path');

const portalFile = path.resolve(__dirname, '../src/CompanyPortal.tsx');
let content = fs.readFileSync(portalFile, 'utf8');

const oldBlock = `                    <article className="portal-ticket-row" key={ticket.id}>
                      <div>
                        <span className={\`ticket-kind ${ticket.kind}\`}>{ticketKindLabels[ticket.kind]}</span>
                        <h3>{ticket.subject}</h3>
                        <p>{ticket.lastUpdate}</p>
                      </div>
                      <strong>{ticketStatusLabels[ticket.status]}</strong>
                    </article>`;

const newBlock = `                    <article className="portal-ticket-row" key={ticket.id}>
                      <div>
                        <span className={\`ticket-kind ${ticket.kind}\`}>{ticketKindLabels[ticket.kind]}</span>
                        <h3>{ticket.subject}</h3>
                        <p>{ticket.lastUpdate}</p>
                        <div className="portal-ticket-thread-preview">
                          {ticket.messages.slice(-3).map((message) => (
                            <div className={\`portal-ticket-message ${message.author}\`} key={message.id}>
                              <strong>{message.author === 'owner' ? 'Support' : message.authorName}</strong>
                              <span>{message.body}</span>
                              <small>{message.createdAt}</small>
                            </div>
                          ))}
                          {!ticket.messages.some((message) => message.author === 'owner') ? (
                            <em>No reply from support yet.</em>
                          ) : null}
                        </div>
                      </div>
                      <strong>{ticketStatusLabels[ticket.status]}</strong>
                    </article>`;

if (content.includes(oldBlock) && !content.includes('portal-ticket-thread-preview')) {
  content = content.replace(oldBlock, newBlock);
} else {
  console.warn('Portal support replies patch skipped.');
}

fs.writeFileSync(portalFile, content);
console.log('Portal support replies patch applied.');

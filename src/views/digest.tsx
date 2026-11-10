import type { DigestNight } from '../digest/types.js';

export function Digest({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.badLines > 0 && (
        <p class="warn"><strong>bad lines: {digest.badLines}</strong> (skipped)</p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">job</th>
                <th scope="col">owner</th>
                <th scope="col">runs</th>
                <th scope="col">retries</th>
                <th scope="col">last status</th>
                <th scope="col">last error</th>
                <th scope="col">first at</th>
                <th scope="col">last at</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map(row => (
                <tr>
                  <th scope="row">{row.job}</th>
                  <td>{row.owner ?? '\u2014'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries >= 3 ? <strong class="warn">{row.retries}</strong> : row.retries}</td>
                  <td>{row.lastStatus === 'fail' ? <strong class="warn">{row.lastStatus}</strong> : row.lastStatus}</td>
                  <td>{row.lastError ?? '\u2014'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}